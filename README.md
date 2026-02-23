# GIF Viewer

**Bring your VS Code sidebar to life with animated GIFs.** Pick a favorite, grab a random one, or let them cycle automatically while you code.

![Demo](https://media.giphy.com/media/artj92V8o75VPL7AeQ/giphy.gif)

---

## Modes

| Mode | How it works |
|------|-------------|
| **Manual** | Display a fixed GIF from any public URL |
| **Random** | Click a button to load a new random GIF |
| **Auto** | GIFs cycle automatically on a timer |

---

## Quick Start

**Manual** — paste any GIF URL:
```json
{
    "gifViewer.mode": "manual",
    "gifViewer.gifUrl": "https://example.com/my-gif.gif"
}
```

**Random** — set a tag and click the button in the panel:
```json
{
    "gifViewer.mode": "random",
    "gifViewer.searchTag": "coding",
    "gifViewer.apiKey": "your-klipy-key"
}
```

**Auto** — GIFs change on their own:
```json
{
    "gifViewer.mode": "auto",
    "gifViewer.searchTag": "celebration",
    "gifViewer.autoChangeInterval": 60,
    "gifViewer.apiKey": "your-klipy-key"
}
```

> You can also change the GIF at any time via `Ctrl+Shift+P` → **GIF Viewer: Change GIF**

---

## Configuration

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `gifViewer.mode` | string | `"manual"` | Display mode: `manual`, `random`, or `auto` |
| `gifViewer.gifUrl` | string | `""` | GIF URL (manual mode) |
| `gifViewer.width` | string | `"100%"` | GIF width (e.g. `100%`, `250px`) |
| `gifViewer.height` | string | `"150px"` | GIF height (e.g. `150px`, `auto`) |
| `gifViewer.apiKey` | string | `""` | Klipy API Key (required for random and auto modes) |
| `gifViewer.searchTag` | string | `"celebration"` | Tag used to search GIFs |
| `gifViewer.autoChangeInterval` | number | `30` | Seconds between changes (auto mode, min: 5) |

### Popular tags to try

`coding` · `programming` · `cat` · `dog` · `celebration` · `motivation` · `funny` · `space` · `pixel-art` · `win`

---

## Troubleshooting

**GIF not showing**
- Check that the URL is publicly accessible
- In random/auto mode, verify your internet connection
- Try reloading VS Code: `Ctrl+Shift+P` → **Reload Window**

**Random/Auto fails to load**
- Make sure `gifViewer.apiKey` is set in your settings
- Try a broader tag like `cat` or leave it empty to use trending GIFs
- Open the Developer Tools console for detailed error messages

**Buttons not visible**
- The Random and Auto buttons only appear in `random` and `auto` modes

---

## Getting a Klipy API Key

GIF Viewer uses the [Klipy API](https://klipy.com) — **free and unlimited** after a simple approval.

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
