# Copy / Paste GIF — Plan v1.8.0

Right-click menu **Copy URL** + **Paste**, and **Ctrl/Cmd+V**, so the panel can show a GIF from **any** public URL or a clipboard image — not only Klipy.

Klipy stays the source for Random / Auto / Search. Paste is a third input, like Manual URL, without writing `gifViewer.gifUrl`.

---

## Product

| Action | Behaviour |
|--------|-----------|
| Left-click GIF | Unchanged: copy **canonical** URL (not `img.src` if it is a webview URI) |
| Right-click panel | Custom menu: **Copy URL** (disabled if none / local file), **Paste** |
| Ctrl/Cmd+V | Paste, unless focus is the search input |
| Paste http(s) URL | `setGif(url)` — Giphy, Tenor, Discord CDN, etc. |
| Paste image file | Save under `globalStorage/pasted/`, display via `asWebviewUri` |
| Persist | Remote URL → `lastGifUrl`. Local file → `local-media:<filename>` so reload still works |

Do **not** update `gifViewer.gifUrl` on paste (same as Random). Clearing settings does not wipe a pasted GIF.

No new Settings entry.

---

## Why a custom HTML menu

`webview/context` is awkward (when-clauses, no disable-per-gif). A small themed overlay in the webview is enough:

- `contextmenu` → `preventDefault`, show menu at cursor
- Click outside / Escape / scroll → hide
- VS Code tokens (`--vscode-menu-*` if present, else button/input colors)

```
┌─────────────┐
│ Copy URL    │  disabled when !copyUrl
│ Paste       │
└─────────────┘
```

---

## 1. Canonical URL vs display URL

Today click-to-copy sends `gifElement.src`. After local paste that is `vscode-webview://…` — useless outside the editor.

`setGif` message becomes:

```typescript
{ type: 'setGif', gifUrl: string, copyUrl: string }
```

- `gifUrl` — what `<img>` loads (http(s) or webview URI)
- `copyUrl` — http(s) to put on the clipboard; `''` for local files

Webview keeps `let copyUrl = '...'`. Copy (click or menu) uses `copyUrl`, not `img.src`. If empty, skip copy and toast from the host: `This GIF has no public URL`.

---

## 2. Host: `extension.ts`

### Webview roots

```typescript
webviewView.webview.options = {
    enableScripts: true,
    localResourceRoots: [this._extensionUri, this._context.globalStorageUri]
};
```

Create `globalStorageUri` on first paste (`fs.createDirectory`).

### Messages

| Type | Data | Action |
|------|------|--------|
| `copyGifUrl` | `{ url }` | Existing. Ignore empty. |
| `pasteText` | `{ text }` | Parse URL(s), then `setGif` |
| `pasteImage` | `{ mime, data }` base64 | Write file, `setGif` local |

### URL paste

Accept only:

- `http:` / `https:`
- `trim`, take first line / first `text/uri-list` entry
- Reject `javascript:`, `data:`, `file:`, `vscode:` (data URLs come as `pasteImage` if at all)

Invalid → `showErrorMessage('Clipboard does not contain a GIF URL or image')`.

### Image paste

Allowed MIME: `image/gif`, `image/png`, `image/webp`, `image/jpeg`.

1. Cap **12 MB** decoded; over → error
2. Ext from mime: `.gif` / `.png` / `.webp` / `.jpg`
3. Path: `globalStorage/pasted/<timestamp>-<rand>.<ext>`
4. `workspace.fs.writeFile`
5. Persist `lastGifUrl = local-media:<filename>`
6. Display `webview.asWebviewUri(fileUri).toString()`

Keep the last **20** pasted files; delete older (avoid unbounded storage).

### Resolve local media

```typescript
private readonly LOCAL_PREFIX = 'local-media:';

private toDisplayUrl(stored: string): string {
    if (!stored.startsWith(LOCAL_PREFIX) || !this._view) return stored;
    const file = vscode.Uri.joinPath(this._context.globalStorageUri, 'pasted', stored.slice(LOCAL_PREFIX.length));
    return this._view.webview.asWebviewUri(file).toString();
}

private toCopyUrl(stored: string): string {
    return stored.startsWith('http://') || stored.startsWith('https://') ? stored : '';
}
```

`setGif(stored)` always saves `stored` in `_currentGif` + `lastGifUrl`, posts `{ gifUrl: toDisplayUrl(stored), copyUrl: toCopyUrl(stored) }`.

`_getHtmlContent` initial `<img src>` uses `toDisplayUrl(this._currentGif)` — if view is not resolved yet, `resolveWebviewView` runs first so `_view` exists.

If local file is missing on reload → empty state (don’t crash).

### Optional command (same PR)

`gifViewer.pasteGif` — `clipboard.readText()`, then same URL parser. Palette-friendly; **cannot** paste binary images (VS Code API is text-only). Images stay on the webview `paste` event.

---

## 3. Webview JS/CSS

### Context menu

- `#ctxMenu` hidden by default, `position: fixed`, z-index high
- `document` `contextmenu`: if target is `input`, allow native paste/copy; else preventDefault and show
- `Copy URL` → existing `copyGifUrl` with `copyUrl`
- `Paste` → `navigator.clipboard.read()` when available, else toast “Use Ctrl+V”
  - Clipboard API in VS Code webviews is unreliable → **Paste menu item should synthesize a paste** or tell the user to Ctrl+V

**Practical approach:** menu **Paste** focuses the webview and we cannot read the OS clipboard from the menu click on all platforms.

Reliable pattern:

1. **Ctrl/Cmd+V** is the real paste path (`paste` event has `clipboardData`)
2. Menu **Paste** → `document.execCommand('paste')` is dead
3. Menu **Paste** → postMessage `pasteRequest` → host `clipboard.readText()` for URLs; if empty, `showInformationMessage('Paste a URL with Ctrl+V, or copy an image and press Ctrl+V in the panel')`

So:

- Menu **Copy URL** — always works (we have the string)
- Menu **Paste** — host reads **text** clipboard (any URL)
- **Ctrl+V** — URLs **and** image files via `paste` event

That matches “right-click copy and paste” for URLs; images need focus + Ctrl+V (document in README).

### `paste` listener

```javascript
document.addEventListener('paste', (e) => {
    if (e.target === searchInput) return;
    e.preventDefault();
    const dt = e.clipboardData;
    const file = [...dt.files].find(f => f.type.startsWith('image/'))
        || [...dt.items].map(i => i.kind === 'file' ? i.getAsFile() : null).find(Boolean);
    if (file && /^image\/(gif|png|webp|jpeg)$/.test(file.type)) {
        const reader = new FileReader();
        reader.onload = () => {
            const b64 = reader.result.split(',')[1];
            vscode.postMessage({ type: 'pasteImage', mime: file.type, data: b64 });
        };
        reader.readAsDataURL(file);
        return;
    }
    const text = dt.getData('text/uri-list') || dt.getData('text/plain');
    if (text.trim()) vscode.postMessage({ type: 'pasteText', text });
});
```

### Click-to-copy

Use `copyUrl`, not `gifElement.src`.

---

## 4. `package.json`

```json
{
  "command": "gifViewer.pasteGif",
  "title": "GIF Viewer: Paste GIF"
}
```

Version **1.8.0**.

README:

- Right-click → Copy URL / Paste
- Ctrl+V in the panel (URL or image)
- Paste is not limited to Klipy
- Local clipboard images have no public URL (Copy disabled)

---

## 5. Implementation order

1. Canonical `copyUrl` in `setGif` + fix click-to-copy
2. `localResourceRoots` + `local-media:` resolve/write/prune
3. `pasteText` / `pasteImage` handlers + URL parser
4. Webview `paste` listener (skip search input)
5. Context menu Copy + Paste (Paste → host `readText`)
6. Command `gifViewer.pasteGif`
7. README
8. `npm run compile`
9. Manual tests

---

## 6. Manual tests

1. Right-click GIF → Copy URL → paste in browser = same GIF (Klipy)
2. Copy a Giphy/Tenor URL → Ctrl+V in panel → displays
3. Right-click → Paste with a URL on the clipboard → same
4. Copy image from OS (or a `.gif` file) → focus panel → Ctrl+V → displays
5. Reload window → remote pasted URL still there; local pasted file still there
6. Copy URL on a local paste → disabled / “no public URL”
7. Paste into search box → still types text, does not replace the GIF
8. `javascript:alert(1)` on clipboard → rejected
9. Random after paste → works (does not write `gifUrl`)
10. Command palette **Paste GIF** with a URL

---

## 7. Risks

| Risk | Mitigation |
|------|------------|
| Webview URI in `lastGifUrl` | Never store it; store `http(s)` or `local-media:` |
| `localResourceRoots` missing storage | Add `globalStorageUri`; mkdir on activate/paste |
| Huge clipboard image | 12 MB cap |
| Menu Paste cannot read images | Ctrl+V for files; menu Paste = text URL via host |
| CSP | None today; keep as-is (already loads arbitrary http img) |

---

## 8. Out of scope

- Drag-and-drop files
- Copy GIF **binary** to OS clipboard
- Writing `gifViewer.gifUrl` on paste
- Clips / video
- New contentType interaction (paste ignores Klipy type)
