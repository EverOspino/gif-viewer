# GIFs + Stickers — Plan v1.7.0

Add Klipy **stickers** next to GIFs. Same panel, same Random/Auto/Search.
**Clips are out of scope** (need `<video>`; later).

Stay on Klipy API v1. Sticker endpoints are the GIF ones with `/gifs/` → `/stickers/`.

---

## Product decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Modes | `gifs` **or** `stickers`, not mixed `all` | Mixed search/random is messy; toggle is enough |
| Default | `gifs` | Existing users unchanged |
| Persistence | `globalState.contentType` (like Auto) | No new settings.json `mode` (just removed) |
| Display | Keep `<img>` | Stickers are gif/webp/png; skip webm |
| Manual URL | Still works in both modes | User pasted a URL; type toggle does not clear it |
| Commands | Same names (`randomGif`, `searchGif`) | They follow the **current** type |

UI: compact GIF | Sticker control in the hover **controls** bar, left of Random.

```
[ GIF | Sticker ]  [Random]  [Auto]
```

Search placeholder follows type: `Search GIFs...` / `Search stickers...`.

---

## Klipy facts (already verified)

- `GET api/v1/{key}/stickers/search` and `.../stickers/trending`
- Same query params as GIFs: `page`, `per_page`, `q`, `customer_id`, …
- Same envelope: `{ result, data: { data[], current_page, has_next } }`
- `file.{hd,md,sm,xs}` has **gif, webp, webm, png** (no jpg/mp4 in the sticker sample)
- Mean `md.gif` ~795 KB; `md.webp` ~257 KB; `md.png` ~23 KB (often static)

Prefer **animated, `<img>`-safe** URLs:

```
md.gif → md.webp → md.png
sm.gif → sm.webp → sm.png   // thumbnails
```

Never `webm` in this version.

---

## 1. Changes to `gifService.ts`

### Types

```typescript
export type ContentType = 'gifs' | 'stickers';

export interface GifApiResponse {
    url: string;
    thumbnail?: string;
    title?: string;
}

interface MediaFile {
    url: string;
    width: number;
    height: number;
    size: number;
}

interface KlipySize {
    gif?: MediaFile;
    webp?: MediaFile;
    png?: MediaFile;
    mp4?: MediaFile;
    webm?: MediaFile;
}
```

Relax `KlipyGifFile` so missing `gif` does not blow up (stickers / partial payloads).

### URL picker

```typescript
private pickImageUrl(size?: KlipySize): string | undefined {
    return size?.gif?.url || size?.webp?.url || size?.png?.url;
}
```

`toApiResponse`: `url = pickImageUrl(file.md)`, skip if none.
Search mapping: `url = pickImageUrl(file.md)`, `thumbnail = pickImageUrl(file.sm) || url`. Skip items with no url.

### Pool key includes type

Today: `trending` | `search:cat`  
After: `gifs:trending` | `stickers:search:cat`

`RandomPool` gains `contentType: ContentType`. Switching GIF↔Sticker drops the deck (new key).

### Fetch path

```typescript
private contentPath(type: ContentType): 'gifs' | 'stickers' {
    return type;
}
```

```
.../api/v1/{appKey}/{gifs|stickers}/{search|trending}?…
```

Pass `contentType` into `getRandomGif` and `searchGifs`:

```typescript
async getRandomGif(tag: string, apiKey?: string, contentType?: ContentType): Promise<GifApiResponse>
async searchGifs(query: string, page: number, perPage: number, apiKey?: string, contentType?: ContentType): Promise<GifSearchResult>
```

Default `contentType` to `'gifs'` so call sites that forget it stay safe.

`dealRandomGif` / `fetchRandomPage` / `poolKey` take the type.
`ensureDeck` error string can stay `No GIFs found from Klipy` or become `No results found from Klipy` (prefer the generic one).

Recent URLs stay a single list (GIF and sticker URLs mixed). Fine: they never collide.

---

## 2. Changes to `extension.ts`

### State

```typescript
private _contentType: ContentType = 'gifs';
```

Constructor: `this._contentType = context.globalState.get<ContentType>('contentType') || 'gifs'`
Validate against `'gifs' | 'stickers'`; anything else → `gifs`.

### Messages

| Direction | Type | Data |
|-----------|------|------|
| webview → host | `setContentType` | `{ contentType: 'gifs' \| 'stickers' }` |
| host → webview | `contentType` | `{ contentType }` |

On `setContentType`:

1. Ignore invalid values
2. Save `_contentType` + `globalState.contentType`
3. `postMessage({ type: 'contentType', contentType })` (placeholder / toggle active state)
4. If search input is non-empty, re-run `searchGifs(query, 1)` for the new type
5. Do **not** auto-fetch Random (user already has a displayed item). Next Random/Auto uses the new type.

### Call sites

- `loadRandomGif` → `getRandomGif(searchTag, apiKey, this._contentType)`
- `searchGifs` → `searchGifs(query, page, perPage, apiKey, this._contentType)`
- Error toast: `Failed to load random GIF` → `Failed to load random media` (or keep GIF wording; prefer **media** now that stickers exist)

### Initial HTML

- Toggle in `.controls` before Random
- Active segment uses existing `.active` button style
- Search placeholder from `_contentType`
- Body class optional: `content-gifs` / `content-stickers` if we want sticker-specific CSS (checkerboard). **Skip checkerboard in v1.7** unless transparency looks broken on the sidebar background.

### Webview JS

- `gifBtn` / `stickerBtn` (or one segmented control)
- Click → `postMessage({ type: 'setContentType', contentType })`
- On `contentType`: update active class + placeholder; do not clear the current `<img>`
- Cooldown 300 ms is enough (not 3s like Random)

HTML stays an `<img>` for both types.

---

## 3. `package.json`

No new setting (toggle is in the panel).

Optional later, **not in this PR**:

```json
"gifViewer.contentType": { "enum": ["gifs", "stickers"], "default": "gifs" }
```

Version **1.7.0**.

README: one bullet under Features — “GIFs or stickers (toggle in the panel)”. Placeholder / search copy.

---

## 4. Behaviour matrix

| Action | GIFs mode | Stickers mode |
|--------|-----------|---------------|
| Random, empty tag | `gifs/trending` | `stickers/trending` |
| Random, `searchTag=cat` | `gifs/search?q=cat` | `stickers/search?q=cat` |
| Search bar | `gifs/search` | `stickers/search` |
| Auto | same as Random | same as Random |
| Switch type mid-Auto | next tick uses new type | same |
| Manual `gifUrl` | shown | still shown until Random/select |
| Reload window | type restored | type restored |

---

## 5. Implementation order

1. Relax media types + `pickImageUrl` + use it in `toApiResponse` / `searchGifs`
2. `ContentType` on pool key + fetch path; thread through `getRandomGif` / `searchGifs`
3. Provider state + `setContentType` handler + pass type into service
4. Webview toggle + placeholder
5. README one-liner
6. `npm run compile`
7. Manual tests
8. Bump `1.7.0`

---

## 6. Manual tests

1. Default: still GIFs after install / with empty `contentType`
2. Toggle Sticker → Random → sticker-looking asset (often transparent / smaller)
3. Toggle back to GIF → Random → GIF
4. Search `cat` in GIF mode vs sticker mode: different libraries
5. Switch type with search open: grid refreshes, page 1
6. Auto ON, switch type, wait one interval → new type appears
7. Reload window → toggle state restored
8. Manual URL still displays in both modes
9. Nonsense tag in sticker mode → error, loading flag clears
10. Click sticker copies URL

---

## 7. Risks

| Risk | Mitigation |
|------|------------|
| Some stickers have no `gif`, only png/webp | `pickImageUrl` fallback chain |
| Transparent sticker + blur background looks muddy | Accept in v1.7; hide blur for png-only later if needed |
| `searchTag` tuned for GIFs (e.g. `coding`) is weak for stickers | Same setting; user can clear it |
| Sidebar name still “GIF Viewer” | Keep name; type is a mode, not a new view |

---

## 8. Explicitly not in this plan

- Clips / `<video>`
- Mixed `all` mode
- Klipy v2
- Checkerboard background
- Renaming the extension
- New VS Code setting for content type
