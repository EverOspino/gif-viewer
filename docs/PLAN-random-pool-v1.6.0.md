# Random GIF Pool — Plan v1.6.0

Stay on Klipy API v1. Stop treating random as “fetch 50, pick 1, throw away the rest”.
Cache the page, shuffle it, deal from the deck, persist recently shown URLs.

Covers **Random** (button / command) and **Auto** (same `getRandomGif()`).
Does **not** change sidebar search, v2, or webview UI.

---

## Problem

Today (`gifService.ts`):

1. `page = random(1..10)` — arbitrary cap, empty-page retries, relevance-biased pool.
2. Fetches 50 GIFs, uses 1, discards 49.
3. `_recentGifs` (max 10) lives only in memory — reset on every window reload.
4. Concurrent Random + Auto can race two fetches and skip the deck.

Klipy v1 has no `random` parameter. Local shuffle of a cached page is the right fix.

---

## Goal

| Metric | Now | After |
|--------|-----|--------|
| API calls per 50 randoms | ~50 (plus retries) | 1 (same tag/trending) |
| Variety (with tag) | ~top pages, repeats after reload | full pages in order, shuffled |
| Variety (trending) | same | same approach |
| Repeats across sessions | none avoided | last `MAX_RECENT` URLs skipped |

User-visible: Random/Auto feel less repetitive. No new settings.

---

## 1. Changes to `gifService.ts`

### Remove

- `RANDOM_PAGE_RANGE`
- `searchRandomGif()` / `getTrendingRandomGif()` as separate fetch-and-pick paths
- `pickRandomGif()` (replaced by pop-from-deck)

Keep `getRandomGif(tag, apiKey)` as the public API so `extension.ts` does not change its call site.

### Constants

```typescript
private static readonly POOL_PER_PAGE = 50; // Klipy max
private static readonly MAX_RECENT = 30;
```

No new `package.json` settings.

### Storage port (no vscode import in the service)

```typescript
export interface GifRecentStore {
    getRecent(): string[];
    setRecent(urls: string[]): void;
}

constructor(store?: GifRecentStore)
```

- On construct: `_recentGifs = store?.getRecent() ?? []`
- After each deal: trim to `MAX_RECENT`, `store?.setRecent(this._recentGifs)`
- If `store` is omitted (tests / current constructor), memory-only (today’s behaviour)

### Pool state

```typescript
interface RandomPool {
    key: string;            // "trending" | "search:<normalized-tag>"
    deck: GifApiResponse[]; // remaining, already shuffled
    nextPage: number;       // 1-based page to fetch when deck is empty
    hasNext: boolean;
}
```

Private field: `_pool?: RandomPool`

Invalidate when `pool.key` ≠ current key (tag changed). Do **not** persist the pool — trending should refresh after reload.

### Fetch helper

Replace `fetchKlipyData()` with something that keeps pagination metadata:

```typescript
interface KlipyPage {
    gifs: KlipyGifData[];
    page: number;
    hasNext: boolean;
}

private async fetchKlipyPage(url: string): Promise<KlipyPage>
```

- Same error on `!response.ok`
- Empty / `result: false` → `{ gifs: [], page: 1, hasNext: false }`
- Leave `searchGifs()` on its own fetch unless the swap is a trivial DRY (optional, same PR only if riskless)

### Map + shuffle

```typescript
private toApiResponse(gif: KlipyGifData, fallbackTitle: string): GifApiResponse | null
```

- Use `gif.file?.md?.gif?.url` — skip items missing `md.gif` (avoids today’s TypeError)
- `title: gif.title || fallbackTitle`

```typescript
private shuffle<T>(items: T[]): T[]  // Fisher–Yates, in place or copy
```

Do **not** use `.sort(() => Math.random() - 0.5)`.

### Refill algorithm (`ensureDeck`)

Called when `deck.length === 0`:

1. Build URL:
   - tag non-empty → `.../gifs/search?q=&per_page=50&page=&customer_id=`
   - else → `.../gifs/trending?per_page=50&page=&customer_id=`
2. `fetchKlipyPage`
3. If `gifs.length === 0`:
   - if `nextPage === 1` → throw `No GIFs found from Klipy` (same user-facing idea as today)
   - else wrap: `nextPage = 1`, `hasNext = true`, retry **once** (new trending set)
4. Map → skip nulls → shuffle
5. Filter out URLs in `_recentGifs`
6. If filter empties the list → use the unfiltered shuffled page (escape hatch; never infinite-loop)
7. `deck = mapped`, `hasNext = page.hasNext`, `nextPage = hasNext ? page.page + 1 : 1`

Wrap-around after the last page starts a new cycle (page 1). Recent list still blocks immediate repeats.

### Deal (`getRandomGif`)

```
key = normalize(tag) ? `search:${normalize(tag)}` : 'trending'
if pool missing or pool.key !== key → reset pool { key, deck: [], nextPage: 1, hasNext: true }
await ensureDeck()
gif = deck.shift()
push url onto _recentGifs, trim, persist
return gif
```

`normalize(tag)`: `trim` + collapse inner space; keep case as sent to Klipy in the query, but use lowercased key so `"Cat"` and `"cat"` share a pool.

### Concurrency lock

Random button + Auto can overlap. Cache is wrong if two fetches refill at once.

```typescript
private _randomTail: Promise<unknown> = Promise.resolve();

async getRandomGif(...): Promise<GifApiResponse> {
    const run = this._randomTail.then(() => this.dealRandomGif(...));
    this._randomTail = run.then(() => undefined, () => undefined);
    return run;
}
```

Caller 2 waits, then pops the **next** card from the same deck (no extra API, no duplicate GIF).

Do not coalesce into one shared Promise (that would give both callers the same URL).

### Errors

Stop wrapping `throw new Error(\`Failed ...: ${error}\`)` on top of an `Error`.
Rethrow or throw once with a short message (`Klipy API error: 429`, `No GIFs found from Klipy`).
`loadRandomGif` in `extension.ts` already prefixes `Failed to load random GIF:`.

### Out of scope for this file

- Persist `customerId` — small follow-up if we already pass a store; **include it** (see §2) because the store is being wired anyway
- `validateGifUrl()` — still unused, do not touch
- v2 / `random=true`

---

## 2. Changes to `extension.ts`

### Constructor of `GifService`

```typescript
this._gifService = new GifService({
    getRecent: () => this._context.globalState.get<string[]>('recentGifUrls') ?? [],
    setRecent: (urls) => { void this._context.globalState.update('recentGifUrls', urls); }
});
```

`globalState.get` is sync; `update` is fire-and-forget.

### Persist `customerId` (same store pass)

While wiring `globalState` into the service:

- Read `klipyCustomerId` from `globalState`
- If missing, generate once and `update`
- Pass the stable id into `GifService` (constructor arg or store field)

Klipy docs: `customer_id` must stay consistent for the same user. Today it is regenerated on every activate.

No webview, command, or HTML changes.
`loadRandomGif` / Auto keep calling `getRandomGif`.

---

## 3. No `package.json` / webview / README required

- No new settings
- README already says Random uses `searchTag` or trending — internals do not need a user-facing paragraph
- Optional one-liner later if we want: “Random cycles a shuffled batch and skips recently shown GIFs”

Bump version to **1.6.0** after the uncommitted 1.5.0 work is settled.

---

## 4. Behaviour matrix

| Input | Pool key | Endpoint | Pages |
|-------|----------|----------|--------|
| `searchTag` empty | `trending` | `gifs/trending` | 1, 2, … until `has_next` false, then wrap |
| `searchTag` = `coding` | `search:coding` | `gifs/search?q=coding` | same |
| User changes `searchTag` | new key | new pool, page 1 | old deck dropped |
| Window reload | recent restored, pool empty | first Random/Auto fetches page 1 again | trending stays fresh |
| Auto + Random overlap | same pool | second waits, pops next card | |

Selecting a GIF from **search results** does not go through the pool (unchanged). Optionally push that URL into `_recentGifs` so Auto does not show it immediately — **nice-to-have, not required**.

---

## 5. Implementation order

1. `KlipyPage` + `fetchKlipyPage` + null-safe `toApiResponse`
2. `RandomPool`, Fisher–Yates, `ensureDeck`, wrap/escape-hatch
3. `GifRecentStore` + load/save recent; persist `customerId`
4. Serialize `getRandomGif` with the lock
5. Delete `RANDOM_PAGE_RANGE`, old random helpers, `pickRandomGif`
6. Manual tests (below)
7. `npm run compile`
8. Version `1.6.0` when packaging

---

## 6. Manual tests

No test runner in the repo. Exercise in Extension Host:

1. **Trending Random** — 5 clicks, 5 different GIFs, one network round-trip after the first (DevTools / output)
2. **Tagged Random** — `searchTag: cat`, 5 clicks, all cat-related, no immediate repeats
3. **Tag switch** — `cat` → `coding`, next Random is coding (new pool)
4. **Auto** — enable, wait 2 intervals, GIF changes, no error toast
5. **Auto + Random** — click Random during Auto; two different GIFs, no double error
6. **Reload window** — last GIF still shown (`lastGifUrl`); next Random ≠ last few (recent persisted)
7. **Empty tag result** — nonsense tag like `zzzxqwerty999` → error message, UI loading flag clears
8. **Search panel** — type a query, grid still paginates (untouched path)

---

## 7. Risks

| Risk | Mitigation |
|------|------------|
| Klipy `has_next` lies / empty later pages | empty page + `nextPage > 1` wraps to 1 |
| Entire page already in recent | escape hatch: deal unfiltered shuffled page |
| Wrap loop if page 1 always empty | throw on empty page 1, do not retry forever |
| `md.gif` missing | skip item |
| `globalState` recent grows forever | cap `MAX_RECENT = 30` |
| Stale trending after hours of Auto | wrap refetches page 1; pool not persisted |

---

## 8. Explicitly not in this plan

- Klipy v2 / `random=true`
- AbortController / fetch timeout
- Pause Auto on search-result select
- Extract webview HTML, CSP, API key SecretStorage
- New user settings
- Unit tests (no harness yet)
