# GIF Search Feature — Plan v1.2.0

## Overview

Add an integrated GIF search bar inside the GIF Viewer sidebar panel, allowing users to search for specific GIFs, browse results as a thumbnail grid, and select one to display.

---

## 1. Changes to `gifService.ts`

### New type

```typescript
export interface GifSearchResult {
    gifs: GifApiResponse[];
    page: number;
    hasNext: boolean;
}
```

### Update `GifApiResponse`

```typescript
export interface GifApiResponse {
    url: string;
    thumbnail?: string;  // small quality for grid
    title?: string;
}
```

### New method `searchGifs()`

```typescript
async searchGifs(query: string, page: number, apiKey?: string): Promise<GifSearchResult>
```

- Reuse existing Klipy endpoint `gifs/search` with `page` parameter
- Return array of results with `gif.sm.gif.url` as thumbnail, `gif.md.gif.url` as selection URL
- Support pagination via `current_page` and `has_next` from Klipy response
- Per page: 12 results (configurable via `gifViewer.resultsPerPage`)

---

## 2. Changes to `extension.ts`

### New message handlers in `onDidReceiveMessage`

| Message | Data | Action |
|---------|------|--------|
| `searchGif` | `{ query, page }` | Call `searchGifs()`, send `searchResults` to webview |
| `selectGif` | `{ url }` | Call `setGif(url)` to display selected GIF |
| `clearSearch` | — | Clear search results grid |

### New command `gifViewer.searchGif`

- Shows `showInputBox` for query input
- Executes search and focuses the sidebar panel with results

### New method `searchGifs()` on `GifViewProvider`

```typescript
public async searchGifs(query: string, page: number): Promise<void>
```

- Get apiKey from config (fallback to KLIPY_APP_KEY)
- Call `this._gifService.searchGifs(query, page, apiKey)`
- Send `searchResults` message to webview with gifs array, page, hasNext
- On error, send `searchError` message

---

## 3. Changes to Webview (HTML/CSS/JS)

### New layout

```
┌──────────────────────────────┐
│ [🔍 Search GIFs...         ] │  ← Search input
├──────────────────────────────┤
│                              │
│        Current GIF           │  ← Existing area
│                              │
├──────────────────────────────┤
│ [Random] [Auto] [Search btn] │  ← Controls (Search button added)
├──────────────────────────────┤
│ ┌────┐ ┌────┐ ┌────┐        │  ← Results grid (hidden by default)
│ │ 1  │ │ 2  │ │ 3  │        │
│ └────┘ └────┘ └────┘        │
│ ┌────┐ ┌────┐ ┌────┐        │
│ │ 4  │ │ 5  │ │ 6  │        │
│ └────┘ └────┘ └────┘        │
│      [Load more]            │  ← Pagination
└──────────────────────────────┘
```

### New CSS classes

- `.search-bar` — VS Code styled input (`var(--vscode-input-background)`, `var(--vscode-input-border)`, `var(--vscode-input-foreground)`)
- `.results-grid` — CSS Grid, 3 columns, `gap: 4px`
- `.result-thumb` — Clickable thumbnails with hover opacity effect and border highlight
- `.load-more-btn` — Pagination button styled like controls
- `.no-results` — Inline message when search returns empty

### New JS behavior

- On typing in search input → debounce 500ms → send `searchGif` message
- On click thumbnail → send `selectGif` message
- On click "Load more" → send `searchGif` with `page + 1`
- On receiving `searchResults` → render thumbnail grid
- On receiving `searchError` → show error message inline
- On receiving `clearSearch` → empty the grid

### New host → webview messages

| Message | Data |
|---------|------|
| `searchResults` | `{ gifs: [{url, thumbnail, title}], page, hasNext }` |
| `searchError` | `{ message }` |
| `clearSearch` | — |

---

## 4. Changes to `package.json`

### New command

```json
{
    "command": "gifViewer.searchGif",
    "title": "GIF Viewer: Search GIF"
}
```

### New configuration

```json
"gifViewer.resultsPerPage": {
    "type": "number",
    "default": 12,
    "minimum": 6,
    "maximum": 50,
    "description": "Number of search results per page"
}
```

---

## 5. Behavior by Mode

| Mode | Search bar | Behavior on select |
|------|-----------|-------------------|
| **Manual** | Always visible | Replaces current GIF |
| **Random** | Always visible | Replaces current GIF (doesn't affect random flow) |
| **Auto** | Always visible | Pauses auto-change, shows selected GIF |

Search bar is global — works in every mode.

---

## 6. Implementation Order

1. `gifService.ts` — add `searchGifs()` method and new types
2. `extension.ts` — add `searchGif`, `selectGif` handlers and new command
3. Webview HTML/CSS/JS — add search bar, results grid, styles, JS logic
4. `package.json` — new command and `resultsPerPage` setting
5. Manual testing in each mode (manual, random, auto)
6. Update `README.md` with search feature documentation
7. Bump version to `1.2.0`

---

## 7. Technical Considerations

- **Debounce**: Search should not fire on every keystroke — 500ms delay
- **Thumbnails**: Use `sm` quality for grid thumbnails, `md` for selected GIF display
- **State management**: Keep search results visible after selecting a GIF so users can browse multiple results
- **Responsive grid**: Adapt columns (2-3) based on sidebar width using CSS `auto-fill` and `minmax()`
- **Error handling**: Show friendly message when no results found or API fails
- **Loading state**: Show spinner in grid area while searching (reuse existing loading indicator pattern)
- **Memory**: Clear search results when switching modes or closing panel to free DOM nodes
