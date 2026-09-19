# GIF Viewer

**Bring your editor sidebar to life with animated GIFs.** Pick a favorite, grab a random one, or let them cycle automatically while you code. Works in VS Code and other [Open VSX](https://open-vsx.org/)-compatible editors (VSCodium, Cursor, Gitpod, and similar).

![Demo](https://raw.githubusercontent.com/EverOspino/gif-viewer/master/preview.gif)

---

## Installation

1. Open VS Code, VSCodium, Cursor, or another compatible editor
2. Go to the Extensions panel (`Ctrl+Shift+X`)
3. Search for **GIF Viewer**
4. Click **Install**

Also available on the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=gifviewer.gif-viewer) and [Open VSX Registry](https://open-vsx.org/extension/gifviewer/gif-viewer).

After installing, the GIF panel appears in the **Explorer sidebar** at the bottom. Look for the **"GIF Viewer"** section.

---

## Features

- **Manual GIF** — display any GIF from a public URL
- **Random** — load a new random GIF or sticker with a click
- **Auto** — cycle automatically on a timer (the toggle is remembered between sessions)
- **GIFs + stickers** — Random, Auto, and Search mix both by default (change under Settings → GIF Viewer → Content Type)
- **Search** — find the perfect GIF or sticker via the built-in search, powered by [KLIPY](https://klipy.com)
- **Copy / paste** — right-click the panel to copy a public URL or paste a URL from anywhere (not just KLIPY). Paste needs internet; the image is downloaded so it can display in the sidebar.

Random and Auto work **out of the box** — no configuration needed. A default API key is included.

---

## Quick Start

**Manual** — paste any GIF URL (`Ctrl+Shift+P` → **GIF Viewer: Change GIF**):
```json
{
    "gifViewer.gifUrl": "https://media.giphy.com/media/artj92V8o75VPL7AeQ/giphy.gif"
}
```

**Random** — press the **Random** button in the sidebar panel. Optionally narrow the results with one tag or several (comma-separated; one is picked at random each time):
```json
{
    "gifViewer.searchTag": "coding, funny, cat"
}
```

**Auto** — press the **Auto** button in the sidebar. Items cycle every 60 seconds (configurable) and the toggle persists across sessions:
```json
{
    "gifViewer.autoChangeInterval": 120
}
```

**Content type** — GIFs, stickers, or both (`all`, the default):
```json
{
    "gifViewer.contentType": "all"
}
```

**Paste** — copy any GIF URL (Giphy, Tenor, etc.) and right-click the panel → **Paste**. Requires internet. Right-click → **Copy URL** only works for public URLs (KLIPY results and manual `gifUrl`), not for pasted files.

> Tip: Hover the panel to reveal the search bar and buttons. The gear next to the search bar opens GIF Viewer settings. You can also change the GIF via `Ctrl+Shift+P` → **GIF Viewer: Change GIF** or **GIF Viewer: Paste GIF**.

---

## Configuration

Open Settings (`Ctrl+,`) and search for **GIF Viewer**, click the gear next to the panel search bar, or edit `settings.json` directly:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `gifViewer.gifUrl` | string | `""` | URL of the GIF to display |
| `gifViewer.apiKey` | string | `""` | Klipy API Key (optional — a default key is included) |
| `gifViewer.contentType` | `all` / `gifs` / `stickers` | `all` | Content for Random, Auto, and Search |
| `gifViewer.searchTag` | string | `""` | Tag(s) for Random/Auto, comma-separated (leave empty to use trending) |
| `gifViewer.autoChangeInterval` | number | `60` | Seconds between changes in Auto (min: 60) |
| `gifViewer.resultsPerPage` | number | `12` | Number of search results per page |

### Popular tags to try

`coding` · `programming` · `cat` · `dog` · `celebration` · `motivation` · `funny` · `space` · `pixel-art` · `win`

---

## Troubleshooting

**GIF not showing**
- Make sure the Explorer sidebar is open (`Ctrl+Shift+E`)
- Scroll down to find the **GIF Viewer** panel
- If using a manual URL, check that it is publicly accessible
- Try reloading the window: `Ctrl+Shift+P` → **Reload Window**

**Random/Auto fails to load**
- Verify your internet connection
- Try a broader tag like `cat` or leave it empty to use trending
- Open the Developer Tools console (`Help → Toggle Developer Tools`) for error messages

**Paste does nothing / image does not show**
- You need an internet connection; the extension downloads the image
- The clipboard must contain an `http`/`https` URL (right-click → **Paste**, or **GIF Viewer: Paste GIF**)
- Page links (e.g. a Giphy/Tenor page) are resolved to the actual image when possible

**Buttons not visible**
- Hover over the GIF Viewer panel to reveal the search bar and the Random/Auto buttons. They auto-hide when the pointer leaves the panel for a cleaner view.

---

## Using Your Own API Key (Optional)

GIF Viewer uses the [Klipy API](https://klipy.com) and includes a shared key by default. If you want higher rate limits or unlimited access, you can get your own key for free:

1. Sign up at [klipy.com/migrate](https://klipy.com/migrate)
2. Create an app in the Partner Panel
3. Start with the **test key** right away (100 req/min)
4. Request a **production key** for unlimited access (approved in 24–48h)
5. Add it to your settings:
   ```json
   { "gifViewer.apiKey": "your-klipy-app-key" }
   ```

---

## License

MIT
