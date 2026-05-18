# GIF Viewer

**Bring your VS Code sidebar to life with animated GIFs.** Pick a favorite, grab a random one, or let them cycle automatically while you code.

![Demo](https://media.giphy.com/media/artj92V8o75VPL7AeQ/giphy.gif)

---

## Installation

1. Open VS Code
2. Go to the Extensions panel (`Ctrl+Shift+X`)
3. Search for **GIF Viewer**
4. Click **Install**

Or from the terminal:
```
code --install-extension gif-viewer-1.1.0.vsix
```

After installing, the GIF panel appears in the **Explorer sidebar** at the bottom. Look for the **"GIF Viewer"** section.

---

## Modes

| Mode | How it works |
|------|-------------|
| **Manual** | Display a fixed GIF from any public URL |
| **Random** | Click a button to load a new random GIF |
| **Auto** | GIFs cycle automatically on a timer |

Random and Auto modes work **out of the box** — no configuration needed. A default API key is included.

---

## Quick Start

**Manual** — paste any GIF URL (`Ctrl+Shift+P` → **GIF Viewer: Change GIF**):
```json
{
    "gifViewer.mode": "manual",
    "gifViewer.gifUrl": "https://media.giphy.com/media/artj92V8o75VPL7AeQ/giphy.gif"
}
```

**Random** — just switch the mode and press the Random button in the sidebar panel:
```json
{
    "gifViewer.mode": "random",
    "gifViewer.searchTag": "coding"
}
```

**Auto** — GIFs change on their own every 60 seconds:
```json
{
    "gifViewer.mode": "auto",
    "gifViewer.searchTag": "celebration"
}
```

> Tip: You can also change the GIF at any time via `Ctrl+Shift+P` → **GIF Viewer: Change GIF**

---

## Configuration

Open Settings (`Ctrl+,`) and search for **GIF Viewer**, or edit `settings.json` directly:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `gifViewer.mode` | string | `"manual"` | Display mode: `manual`, `random`, or `auto` |
| `gifViewer.gifUrl` | string | `""` | GIF URL (manual mode) |
| `gifViewer.apiKey` | string | `""` | Klipy API Key (optional — a default key is included) |
| `gifViewer.searchTag` | string | `"celebration"` | Tag used to search GIFs |
| `gifViewer.autoChangeInterval` | number | `60` | Seconds between changes (auto mode, min: 60) |
| `gifViewer.resultsPerPage` | number | `12` | Number of search results per page |

### Popular tags to try

`coding` · `programming` · `cat` · `dog` · `celebration` · `motivation` · `funny` · `space` · `pixel-art` · `win`

---

## Troubleshooting

**GIF not showing**
- Make sure the Explorer sidebar is open (`Ctrl+Shift+E`)
- Scroll down to find the **GIF Viewer** panel
- In manual mode, check that the URL is publicly accessible
- Try reloading VS Code: `Ctrl+Shift+P` → **Reload Window**

**Random/Auto fails to load**
- Verify your internet connection
- Try a broader tag like `cat` or leave it empty to use trending GIFs
- Open the Developer Tools console (`Help → Toggle Developer Tools`) for error messages

**Buttons not visible**
- The Random and Auto buttons only appear in `random` and `auto` modes

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
