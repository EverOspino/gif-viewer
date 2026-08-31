import * as vscode from 'vscode';
import { ContentType, GifService } from './gifService';

let gifViewProvider: GifViewProvider;

class GifViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'gifViewer.gifView';
    private _view?: vscode.WebviewView;
    private _extensionUri: vscode.Uri;
    private _currentGif: string = '';
    private _configuredGifUrl: string = '';
    private _gifService: GifService;
    private _context: vscode.ExtensionContext;
    private _autoChangeTimer?: NodeJS.Timeout;
    private _isAutoMode: boolean = false;

    constructor(extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
        this._extensionUri = extensionUri;
        this._context = context;
        this._gifService = new GifService({
            getRecent: () => context.globalState.get<string[]>('recentGifUrls') ?? [],
            setRecent: (urls) => { void context.globalState.update('recentGifUrls', urls); },
            getCustomerId: () => context.globalState.get<string>('klipyCustomerId'),
            setCustomerId: (id) => { void context.globalState.update('klipyCustomerId', id); }
        });
        this._configuredGifUrl = this._getGif();
        if (this._configuredGifUrl) {
            this._currentGif = this._configuredGifUrl;
        } else {
            this._currentGif = context.globalState.get<string>('lastGifUrl') || '';
        }
        if (context.globalState.get<boolean>('autoEnabled')) {
            this.startAutoChange();
        }
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri, this._context.globalStorageUri]
        };

        webviewView.webview.html = this._getHtmlContent();

        // Listen for messages from the webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.type) {
                case 'randomGif':
                    await this.loadRandomGif();
                    break;
                case 'toggleAuto':
                    await this.toggleAutoChange();
                    break;
                case 'searchGif':
                    await this.searchGifs(message.query, message.page || 1);
                    break;
                case 'selectGif':
                    this.setGif(message.url);
                    break;
                case 'copyGifUrl':
                    if (!message.url) {
                        this.showInfo('This GIF has no public URL');
                        break;
                    }
                    await vscode.env.clipboard.writeText(message.url);
                    this.showInfo('GIF URL copied to clipboard');
                    break;
                case 'pasteRequest':
                    await this.pasteFromMenu();
                    break;
                case 'openSettings':
                    vscode.commands.executeCommand('workbench.action.openSettings', 'gifViewer');
                    break;
                case 'openExternal':
                    vscode.env.openExternal(vscode.Uri.parse(message.url));
                    break;
            }
        });

        // When the view becomes visible again, re-sync the GIF
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this._updateWebviewContent();
            }
        });
    }

    private showInfo(message: string) {
        vscode.window.setStatusBarMessage(message, 5000);
    }

    private _getGif(): string {
        const config = vscode.workspace.getConfiguration('gifViewer');
        return config.get<string>('gifUrl') || '';
    }

    private _getContentType(): ContentType {
        const raw = vscode.workspace.getConfiguration('gifViewer').get<string>('contentType') || 'all';
        if (raw === 'gifs' || raw === 'stickers' || raw === 'all') {
            return raw;
        }
        return 'all';
    }

    private static readonly LOCAL_PREFIX = 'local-media:';
    private static readonly MAX_PASTE_BYTES = 12 * 1024 * 1024;
    private static readonly MAX_PASTED_FILES = 20;
    private static readonly FETCH_HEADERS = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/gif,image/*,text/html;q=0.8,*/*;q=0.5'
    };

    private pastedDir(): vscode.Uri {
        return vscode.Uri.joinPath(this._context.globalStorageUri, 'pasted');
    }

    private toDisplayUrl(stored: string): string {
        if (!stored.startsWith(GifViewProvider.LOCAL_PREFIX) || !this._view) {
            return stored;
        }
        const name = stored.slice(GifViewProvider.LOCAL_PREFIX.length);
        if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) {
            return '';
        }
        const file = vscode.Uri.joinPath(this.pastedDir(), name);
        return this._view.webview.asWebviewUri(file).toString();
    }

    private toCopyUrl(stored: string): string {
        return stored.startsWith('http://') || stored.startsWith('https://') ? stored : '';
    }

    private cleanUrl(url: string): string {
        return url.trim().replace(/[),.;]+$/, '');
    }

    private parseHttpUrl(text: string): string | undefined {
        const raw = (text || '').trim();
        if (!raw) {
            return undefined;
        }
        const imgSrc = raw.match(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/i);
        if (imgSrc) {
            return this.cleanUrl(imgSrc[1]);
        }
        const match = raw.match(/https?:\/\/[^\s<>"']+/);
        if (match) {
            return this.cleanUrl(match[0]);
        }
        const first = raw.replace(/\r/g, '').split('\n').map(line => line.trim()).find(line => line && !line.startsWith('#'));
        if (!first) {
            return undefined;
        }
        try {
            const uri = vscode.Uri.parse(first);
            if (uri.scheme === 'http' || uri.scheme === 'https') {
                return first;
            }
        } catch {
            return undefined;
        }
        return undefined;
    }

    private extractImageFromHtml(html: string): string | undefined {
        const og = html.match(/<meta[^>]+property=["']og:image:url["'][^>]+content=["']([^"']+)["']/i)
            || html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
            || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
            || html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
        if (og?.[1]) {
            return this.cleanUrl(og[1]);
        }
        const img = html.match(/<img[^>]+src=["'](https?:\/\/[^"']+\.(?:gif|webp|png|jpe?g)[^"']*)["']/i);
        if (img?.[1]) {
            return this.cleanUrl(img[1]);
        }
        return undefined;
    }

    private mimeToExt(mime: string): string | undefined {
        if (mime === 'image/gif') {
            return 'gif';
        }
        if (mime === 'image/png') {
            return 'png';
        }
        if (mime === 'image/webp') {
            return 'webp';
        }
        if (mime === 'image/jpeg' || mime === 'image/jpg') {
            return 'jpg';
        }
        return undefined;
    }

    private sniffExt(buf: Uint8Array): string | undefined {
        if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
            return 'gif';
        }
        if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
            return 'png';
        }
        if (buf.length >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) {
            return 'webp';
        }
        if (buf.length >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) {
            return 'jpg';
        }
        return undefined;
    }

    private async fetchAsImage(url: string, depth = 0): Promise<{ mime: string; buf: Uint8Array } | undefined> {
        if (depth > 2) {
            return undefined;
        }
        const res = await fetch(url, { redirect: 'follow', headers: GifViewProvider.FETCH_HEADERS });
        if (!res.ok) {
            return undefined;
        }
        const ct = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        const imageExt = /\.(gif|webp|png|jpe?g)(\?|$)/i.test(url);
        if (ct.startsWith('image/') && ct !== 'image/svg+xml') {
            const buf = new Uint8Array(await res.arrayBuffer());
            return { mime: ct, buf };
        }
        if (ct === 'application/octet-stream' && imageExt) {
            const buf = new Uint8Array(await res.arrayBuffer());
            return { mime: 'image/gif', buf };
        }
        if (ct.includes('html')) {
            const html = (await res.text()).slice(0, 1_000_000);
            const next = this.extractImageFromHtml(html);
            if (next && next !== url) {
                return this.fetchAsImage(next, depth + 1);
            }
        }
        return undefined;
    }

    private async savePastedImage(mime: string, buf: Uint8Array): Promise<string | undefined> {
        const ext = this.sniffExt(buf) || this.mimeToExt(mime);
        if (!ext) {
            vscode.window.showErrorMessage('Could not load an image from that URL');
            return undefined;
        }
        if (buf.length > GifViewProvider.MAX_PASTE_BYTES) {
            vscode.window.showErrorMessage('Pasted image is too large (max 12 MB)');
            return undefined;
        }
        await vscode.workspace.fs.createDirectory(this.pastedDir());
        const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(this.pastedDir(), name), buf);
        await this.prunePastedFiles();
        return `${GifViewProvider.LOCAL_PREFIX}${name}`;
    }

    private async prunePastedFiles(): Promise<void> {
        try {
            const dir = this.pastedDir();
            const entries = await vscode.workspace.fs.readDirectory(dir);
            const files = entries
                .filter(([, type]) => type === vscode.FileType.File)
                .map(([name]) => name)
                .sort();
            const extra = files.length - GifViewProvider.MAX_PASTED_FILES;
            if (extra <= 0) {
                return;
            }
            for (const name of files.slice(0, extra)) {
                await vscode.workspace.fs.delete(vscode.Uri.joinPath(dir, name));
            }
        } catch {
            return;
        }
    }

    public setGif(url: string) {
        this._currentGif = url;
        this._context.globalState.update('lastGifUrl', url);
        this._updateWebviewContent();
    }

    public async pasteText(text: string): Promise<void> {
        const url = this.parseHttpUrl(text || '');
        if (!url) {
            vscode.window.showErrorMessage('Clipboard does not contain a GIF URL');
            return;
        }
        if (this._view) {
            this._view.webview.postMessage({ type: 'loading', isLoading: true });
        }
        try {
            const image = await this.fetchAsImage(url);
            if (!image) {
                vscode.window.showErrorMessage('Could not load an image from that URL');
                return;
            }
            const stored = await this.savePastedImage(image.mime, image.buf);
            if (stored) {
                this.setGif(stored);
            }
        } catch {
            vscode.window.showErrorMessage('Could not load an image from that URL');
        } finally {
            if (this._view) {
                this._view.webview.postMessage({ type: 'loading', isLoading: false });
            }
        }
    }

    public async pasteFromClipboardText(): Promise<void> {
        const text = await vscode.env.clipboard.readText();
        await this.pasteText(text);
    }

    public async pasteFromMenu(): Promise<void> {
        const text = await vscode.env.clipboard.readText();
        await this.pasteText(text);
    }

    public async loadRandomGif(): Promise<void> {
        try {
            const config = vscode.workspace.getConfiguration('gifViewer');
            const searchTag = config.get<string>('searchTag') || '';
            const apiKey = config.get<string>('apiKey') || '';

            if (this._view) {
                this._view.webview.postMessage({ type: 'loading', isLoading: true });
            }

            const gifData = await this._gifService.getRandomGif(searchTag, apiKey, this._getContentType());
            this.setGif(gifData.url);

            if (this._view) {
                this._view.webview.postMessage({ type: 'loading', isLoading: false });
            }
        } catch (error) {
            if (this._view) {
                this._view.webview.postMessage({ type: 'loading', isLoading: false });
            }
            vscode.window.showErrorMessage(`Failed to load random GIF: ${error}`);
        }
    }

    public async searchGifs(query: string, page: number): Promise<void> {
        try {
            const config = vscode.workspace.getConfiguration('gifViewer');
            const apiKey = config.get<string>('apiKey') || '';
            const perPage = Math.min(50, Math.max(6, config.get<number>('resultsPerPage') || 12));

            if (this._view) {
                this._view.webview.postMessage({ type: 'searchLoading', isLoading: true });
            }

            const result = await this._gifService.searchGifs(query, page, perPage, apiKey, this._getContentType());

            if (this._view) {
                this._view.webview.postMessage({
                    type: 'searchResults',
                    gifs: result.gifs,
                    page: result.page,
                    hasNext: result.hasNext,
                    query
                });
                this._view.webview.postMessage({ type: 'searchLoading', isLoading: false });
            }
        } catch (error) {
            if (this._view) {
                this._view.webview.postMessage({ type: 'searchLoading', isLoading: false });
                this._view.webview.postMessage({ type: 'searchError', message: `${error}` });
            }
        }
    }

    public startAutoChange(): void {
        if (this._autoChangeTimer) {
            return; // Already running
        }

        const config = vscode.workspace.getConfiguration('gifViewer');
        const interval = config.get<number>('autoChangeInterval') || 60;

        this._isAutoMode = true;
        this._context.globalState.update('autoEnabled', true);

        // Load first GIF immediately
        this.loadRandomGif();

        // Set up timer for automatic changes
        this._autoChangeTimer = setInterval(() => {
            this.loadRandomGif();
        }, interval * 1000);

        if (this._view) {
            this._view.webview.postMessage({ type: 'autoModeStatus', isActive: true });
        }

        this.showInfo(`Auto change enabled (every ${interval}s)`);
    }

    public stopAutoChange(): void {
        if (this._autoChangeTimer) {
            clearInterval(this._autoChangeTimer);
            this._autoChangeTimer = undefined;
            this._isAutoMode = false;
            this._context.globalState.update('autoEnabled', false);

            if (this._view) {
                this._view.webview.postMessage({ type: 'autoModeStatus', isActive: false });
            }

            this.showInfo('Auto change disabled');
        }
    }

    public async toggleAutoChange(): Promise<void> {
        if (this._autoChangeTimer) {
            this.stopAutoChange();
        } else {
            this.startAutoChange();
        }
    }

    public refresh() {
        const gifUrl = this._getGif();
        if (gifUrl !== this._configuredGifUrl) {
            this._configuredGifUrl = gifUrl;
            if (gifUrl) {
                this.setGif(gifUrl);
            }
            // When cleared, keep the currently displayed GIF
        }

        if (this._view) {
            this._updateWebviewContent();
        }
    }

    private _updateWebviewContent() {
        if (!this._view) {
            return;
        }
        this._view.webview.postMessage({
            type: 'setGif',
            gifUrl: this.toDisplayUrl(this._currentGif),
            copyUrl: this.toCopyUrl(this._currentGif)
        });
    }

    public dispose() {
        this.stopAutoChange();
    }

    private _getHtmlContent(): string {
        const displayGif = this.toDisplayUrl(this._currentGif);
        const initialCopyUrl = this.toCopyUrl(this._currentGif);

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@vscode/codicons@0.0.35/dist/codicon.css">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            width: 100%;
            height: 100vh;
            display: flex;
            flex-direction: column;
            background: transparent;
            overflow: hidden;
            font-family: var(--vscode-font-family);
        }

        .search-bar {
            width: 100%;
            padding: 6px 8px;
            border-bottom: 1px solid var(--vscode-panel-border);
            background: var(--vscode-sideBar-background);
            display: flex;
            align-items: center;
            gap: 4px;
            overflow: hidden;
            max-height: 100px;
            transition: max-height 0.25s ease, opacity 0.25s ease,
                padding 0.25s ease, border-bottom-width 0.25s ease;
        }

        body:not(.hover) .search-bar {
            max-height: 0;
            padding-top: 0;
            padding-bottom: 0;
            opacity: 0;
            border-bottom-width: 0;
            pointer-events: none;
        }

        .search-bar input {
            flex: 1;
            padding: 4px 8px;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            color: var(--vscode-input-foreground);
            border-radius: 3px;
            font-size: 12px;
            font-family: var(--vscode-font-family);
            outline: none;
        }

        .search-bar input:focus {
            border-color: var(--vscode-focusBorder);
        }

        .search-bar input::placeholder {
            color: var(--vscode-input-placeholderForeground);
        }

        .search-bar .clear-btn {
            display: none;
            background: none;
            border: none;
            color: var(--vscode-descriptionForeground);
            cursor: pointer;
            padding: 2px 4px;
            font-size: 14px;
            border-radius: 3px;
        }

        .search-bar .clear-btn:hover {
            color: var(--vscode-foreground);
            background: var(--vscode-toolbar-hoverBackground);
        }

        .search-bar .clear-btn.visible {
            display: flex;
        }

        .search-bar .icon-btn {
            background: none;
            border: none;
            color: var(--vscode-descriptionForeground);
            cursor: pointer;
            padding: 2px 4px;
            font-size: 14px;
            border-radius: 3px;
            display: flex;
            align-items: center;
        }

        .search-bar .icon-btn:hover {
            color: var(--vscode-foreground);
            background: var(--vscode-toolbar-hoverBackground);
        }

        .gif-container {
            width: 100%;
            flex: 1;
            min-height: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
            overflow: hidden;
            background: var(--vscode-sideBar-background);
        }

        .gif-background {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            object-fit: cover;
            filter: blur(45px) brightness(0.55) saturate(1.3);
            transform: scale(1.25);
            z-index: 0;
            pointer-events: none;
        }

        .gif-wrapper {
            width: 100%;
            height: 100%;
            position: relative;
            z-index: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
        }

        .gif-wrapper img {
            width: 100%;
            max-height: 100%;
            object-fit: contain;
            display: block;
            transition: opacity 0.3s ease;
        }

        .gif-wrapper img.loading {
            opacity: 0.5;
        }

        .empty-state {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 8px;
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
            text-align: center;
            padding: 0 16px;
        }

        .empty-state .codicon {
            font-size: 28px;
            opacity: 0.6;
        }

        .loading-indicator {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            display: none;
            color: var(--vscode-foreground);
        }

        .loading-indicator.active {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }

        .loading-indicator.active .codicon {
            animation: spin 1s linear infinite;
        }

        .controls {
            width: 100%;
            padding: 8px;
            display: flex;
            gap: 8px;
            justify-content: center;
            background: var(--vscode-sideBar-background);
            border-top: 1px solid var(--vscode-panel-border);
            overflow: hidden;
            max-height: 100px;
            transition: max-height 0.25s ease, opacity 0.25s ease,
                padding 0.25s ease, border-top-width 0.25s ease;
        }

        body:not(.hover) .controls {
            max-height: 0;
            padding-top: 0;
            padding-bottom: 0;
            opacity: 0;
            border-top-width: 0;
            pointer-events: none;
        }

        .controls button {
            padding: 6px 12px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            font-family: var(--vscode-font-family);
            transition: background 0.2s ease;
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .controls button:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .controls button:active {
            transform: scale(0.98);
        }

        .controls button.active {
            background: var(--vscode-inputOption-activeBackground);
            border: 1px solid var(--vscode-inputOption-activeBorder);
        }

        .controls button.cooldown {
            opacity: 0.5;
            pointer-events: none;
            cursor: not-allowed;
        }

        .controls button .codicon {
            font-size: 14px;
        }

        .results-container {
            width: 100%;
            flex-shrink: 0;
            max-height: 40vh;
            overflow-y: auto;
            border-top: 1px solid var(--vscode-panel-border);
            background: var(--vscode-sideBar-background);
        }

        .results-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 4px;
            padding: 8px;
        }

        .result-thumb {
            aspect-ratio: 1;
            border-radius: 4px;
            overflow: hidden;
            cursor: pointer;
            border: 2px solid transparent;
            transition: border-color 0.2s ease, opacity 0.2s ease;
        }

        .result-thumb:hover {
            border-color: var(--vscode-focusBorder);
        }

        .result-thumb img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
        }

        .load-more-btn {
            width: 100%;
            padding: 6px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            cursor: pointer;
            font-size: 11px;
            font-family: var(--vscode-font-family);
            text-align: center;
        }

        .load-more-btn:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .search-status {
            padding: 8px;
            text-align: center;
            color: var(--vscode-descriptionForeground);
            font-size: 11px;
        }

        .search-loading {
            display: none;
            padding: 12px;
            text-align: center;
            color: var(--vscode-descriptionForeground);
            font-size: 11px;
        }

        .search-loading.active {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
        }

        .search-loading .codicon {
            animation: spin 1s linear infinite;
        }

        .search-powered-by {
            padding: 4px 8px;
            text-align: center;
            color: var(--vscode-descriptionForeground);
            font-size: 10px;
            border-top: 1px solid var(--vscode-panel-border);
        }

        .search-powered-by a {
            color: var(--vscode-textLink-foreground);
            text-decoration: none;
            cursor: pointer;
            font-weight: 600;
        }

        .search-powered-by a:hover {
            text-decoration: underline;
        }

        .ctx-menu {
            position: fixed;
            z-index: 1000;
            display: none;
            min-width: 140px;
            padding: 4px 0;
            background: var(--vscode-menu-background, var(--vscode-editorWidget-background));
            color: var(--vscode-menu-foreground, var(--vscode-foreground));
            border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border));
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.36);
            font-size: 12px;
            font-family: var(--vscode-font-family);
        }

        .ctx-menu.visible {
            display: block;
        }

        .ctx-menu button {
            display: block;
            width: 100%;
            text-align: left;
            background: none;
            border: none;
            color: inherit;
            padding: 6px 16px;
            cursor: pointer;
            font-size: 12px;
            font-family: inherit;
        }

        .ctx-menu button:hover:not(:disabled) {
            background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground));
            color: var(--vscode-menu-selectionForeground, var(--vscode-foreground));
        }

        .ctx-menu button:disabled {
            opacity: 0.5;
            cursor: default;
        }
    </style>
</head>
<body>
    <div class="search-bar">
        <input type="text" id="searchInput" placeholder="Search KLIPY..." />
        <button class="clear-btn" id="clearBtn" title="Clear search">
            <i class="codicon codicon-close"></i>
        </button>
        <button class="icon-btn" id="settingsBtn" title="Extension settings">
            <i class="codicon codicon-settings-gear"></i>
        </button>
    </div>

    <div class="gif-container">
        <img id="gifBackground" class="gif-background" src="${displayGif}"${displayGif ? '' : ' style="display: none;"'} />
        <div class="gif-wrapper">
            <img id="gif" src="${displayGif}" alt="GIF"${displayGif ? '' : ' style="display: none;"'} />
            <div class="empty-state" id="emptyState"${displayGif ? ' style="display: none;"' : ''}>
                <i class="codicon codicon-image"></i>
                <span>No GIF set. Add a URL in the extension settings.</span>
            </div>
            <div class="loading-indicator" id="loadingIndicator">
                <i class="codicon codicon-sync"></i>
                <span>Loading...</span>
            </div>
        </div>
    </div>

    <div class="controls">
        <button id="randomBtn" title="Load a random GIF">
            <i class="codicon codicon-refresh"></i>
            Random
        </button>
        <button id="autoBtn" class="${this._isAutoMode ? 'active' : ''}" title="Toggle auto change">
            <i class="codicon codicon-${this._isAutoMode ? 'debug-pause' : 'play'}"></i>
            ${this._isAutoMode ? 'Auto ON' : 'Auto'}
        </button>
    </div>

    <div class="results-container" id="resultsContainer" style="display: none;">
        <div class="search-loading" id="searchLoading">
            <i class="codicon codicon-sync"></i>
            <span>Searching...</span>
        </div>
        <div class="results-grid" id="resultsGrid"></div>
        <div class="search-status" id="searchStatus"></div>
        <button class="load-more-btn" id="loadMoreBtn" style="display: none;">Load more</button>
        <div class="search-powered-by">
            Powered by <a id="klipyLink">KLIPY</a>
        </div>
    </div>

    <div class="ctx-menu" id="ctxMenu">
        <button type="button" id="ctxCopy">Copy URL</button>
        <button type="button" id="ctxPaste">Paste</button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const gifElement = document.getElementById('gif');
        const gifBackground = document.getElementById('gifBackground');
        const loadingIndicator = document.getElementById('loadingIndicator');
        const emptyState = document.getElementById('emptyState');
        const randomBtn = document.getElementById('randomBtn');
        const autoBtn = document.getElementById('autoBtn');
        const searchInput = document.getElementById('searchInput');
        const clearBtn = document.getElementById('clearBtn');
        const settingsBtn = document.getElementById('settingsBtn');
        const resultsContainer = document.getElementById('resultsContainer');
        const resultsGrid = document.getElementById('resultsGrid');
        const searchLoading = document.getElementById('searchLoading');
        const searchStatus = document.getElementById('searchStatus');
        const loadMoreBtn = document.getElementById('loadMoreBtn');
        const ctxMenu = document.getElementById('ctxMenu');
        const ctxCopy = document.getElementById('ctxCopy');
        const ctxPaste = document.getElementById('ctxPaste');

        let currentSearchQuery = '';
        let currentSearchPage = 1;
        let debounceTimer = null;
        let copyUrl = ${JSON.stringify(initialCopyUrl)};

        function clearSearch() {
            searchInput.value = '';
            clearBtn.classList.remove('visible');
            resultsContainer.style.display = 'none';
            resultsGrid.innerHTML = '';
            searchStatus.textContent = '';
            loadMoreBtn.style.display = 'none';
            currentSearchQuery = '';
            currentSearchPage = 1;
        }

        searchInput.addEventListener('input', () => {
            clearBtn.classList.toggle('visible', searchInput.value.length > 0);
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                const query = searchInput.value.trim();
                if (query.length === 0) {
                    clearSearch();
                    return;
                }
                currentSearchQuery = query;
                currentSearchPage = 1;
                vscode.postMessage({ type: 'searchGif', query, page: 1 });
            }, 500);
        });

        clearBtn.addEventListener('click', () => {
            clearSearch();
            searchInput.focus();
        });

        settingsBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'openSettings' });
        });

        document.getElementById('klipyLink')?.addEventListener('click', (e) => {
            e.preventDefault();
            vscode.postMessage({ type: 'openExternal', url: 'https://klipy.com' });
        });

        loadMoreBtn.addEventListener('click', () => {
            currentSearchPage++;
            vscode.postMessage({ type: 'searchGif', query: currentSearchQuery, page: currentSearchPage });
        });

        function setCooldown(btn, ms) {
            btn.classList.add('cooldown');
            setTimeout(() => btn.classList.remove('cooldown'), ms);
        }

        randomBtn?.addEventListener('click', () => {
            if (randomBtn.classList.contains('cooldown')) return;
            setCooldown(randomBtn, 3000);
            vscode.postMessage({ type: 'randomGif' });
        });

        autoBtn?.addEventListener('click', () => {
            if (autoBtn.classList.contains('cooldown')) return;
            setCooldown(autoBtn, 3000);
            vscode.postMessage({ type: 'toggleAuto' });
        });

        function selectGif(url) {
            vscode.postMessage({ type: 'selectGif', url });
        }

        function hideCtxMenu() {
            ctxMenu.classList.remove('visible');
        }

        function showCtxMenu(x, y) {
            ctxCopy.disabled = !copyUrl;
            ctxMenu.classList.add('visible');
            ctxMenu.style.left = x + 'px';
            ctxMenu.style.top = y + 'px';
            const rect = ctxMenu.getBoundingClientRect();
            const maxX = window.innerWidth - rect.width - 4;
            const maxY = window.innerHeight - rect.height - 4;
            ctxMenu.style.left = Math.max(4, Math.min(x, maxX)) + 'px';
            ctxMenu.style.top = Math.max(4, Math.min(y, maxY)) + 'px';
        }

        document.addEventListener('contextmenu', (e) => {
            if (e.target === searchInput) {
                return;
            }
            e.preventDefault();
            showCtxMenu(e.clientX, e.clientY);
        });

        document.addEventListener('click', hideCtxMenu);
        document.addEventListener('scroll', hideCtxMenu, true);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                hideCtxMenu();
            }
        });

        ctxCopy.addEventListener('click', (e) => {
            e.stopPropagation();
            hideCtxMenu();
            vscode.postMessage({ type: 'copyGifUrl', url: copyUrl });
        });

        ctxPaste.addEventListener('click', (e) => {
            e.stopPropagation();
            hideCtxMenu();
            vscode.postMessage({ type: 'pasteRequest' });
        });

        function isSearchActive() {
            return searchInput.value.trim() !== '' ||
                resultsContainer.style.display !== 'none';
        }

        document.body.addEventListener('mouseenter', () => {
            document.body.classList.add('hover');
        });
        document.body.addEventListener('mouseleave', () => {
            if (!isSearchActive()) {
                document.body.classList.remove('hover');
            }
        });

        window.addEventListener('message', event => {
            const message = event.data;

            switch (message.type) {
                case 'setGif':
                    copyUrl = message.copyUrl || '';
                    if (message.gifUrl) {
                        gifElement.src = message.gifUrl;
                        gifElement.style.display = '';
                        gifBackground.src = message.gifUrl;
                        gifBackground.style.display = '';
                        emptyState.style.display = 'none';
                    } else {
                        gifElement.style.display = 'none';
                        gifBackground.style.display = 'none';
                        emptyState.style.display = 'flex';
                    }
                    break;

                case 'loading':
                    if (message.isLoading) {
                        gifElement.classList.add('loading');
                        loadingIndicator.classList.add('active');
                    } else {
                        gifElement.classList.remove('loading');
                        loadingIndicator.classList.remove('active');
                    }
                    break;

                case 'autoModeStatus':
                    if (message.isActive) {
                        autoBtn.classList.add('active');
                        autoBtn.innerHTML = '<i class="codicon codicon-debug-pause"></i> Auto ON';
                    } else {
                        autoBtn.classList.remove('active');
                        autoBtn.innerHTML = '<i class="codicon codicon-play"></i> Auto';
                    }
                    break;

                case 'searchLoading':
                    if (message.isLoading) {
                        resultsContainer.style.display = 'block';
                        searchLoading.classList.add('active');
                        if (currentSearchPage === 1) {
                            resultsGrid.innerHTML = '';
                            searchStatus.textContent = '';
                            loadMoreBtn.style.display = 'none';
                        }
                    } else {
                        searchLoading.classList.remove('active');
                    }
                    break;

                case 'searchResults':
                    resultsContainer.style.display = 'block';
                    if (currentSearchPage === 1) {
                        resultsGrid.innerHTML = '';
                    }
                    if (message.gifs.length === 0 && currentSearchPage === 1) {
                        searchStatus.textContent = 'No results found';
                        loadMoreBtn.style.display = 'none';
                    } else {
                        message.gifs.forEach(gif => {
                            const thumb = document.createElement('div');
                            thumb.className = 'result-thumb';
                            thumb.title = gif.title || '';
                            thumb.onclick = () => selectGif(gif.url);
                            const img = document.createElement('img');
                            img.src = gif.thumbnail || gif.url;
                            img.alt = gif.title || '';
                            img.loading = 'lazy';
                            thumb.appendChild(img);
                            resultsGrid.appendChild(thumb);
                        });
                        searchStatus.textContent = '';
                        loadMoreBtn.style.display = message.hasNext ? 'block' : 'none';
                    }
                    break;

                case 'searchError':
                    searchStatus.textContent = message.message || 'Search failed';
                    loadMoreBtn.style.display = 'none';
                    break;
            }
        });
    </script>
</body>
</html>`;
    }
}

export function activate(context: vscode.ExtensionContext) {
    gifViewProvider = new GifViewProvider(context.extensionUri, context);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            GifViewProvider.viewType,
            gifViewProvider,
            {
                webviewOptions: {
                    retainContextWhenHidden: true
                }
            }
        )
    );

    // Command: Set GIF manually
    const setGifCommand = vscode.commands.registerCommand('gifViewer.setGif', async () => {
        const url = await vscode.window.showInputBox({
            prompt: 'Enter the GIF URL',
            placeHolder: 'https://example.com/my-gif.gif'
        });

        if (url) {
            const config = vscode.workspace.getConfiguration('gifViewer');
            await config.update('gifUrl', url, vscode.ConfigurationTarget.Global);
            gifViewProvider.setGif(url);
        }
    });

    // Command: Load a random GIF
    const randomGifCommand = vscode.commands.registerCommand('gifViewer.randomGif', async () => {
        await gifViewProvider.loadRandomGif();
    });

    // Command: Toggle auto change
    const toggleAutoCommand = vscode.commands.registerCommand('gifViewer.toggleAutoChange', async () => {
        await gifViewProvider.toggleAutoChange();
    });

    // Command: Search GIF
    const searchGifCommand = vscode.commands.registerCommand('gifViewer.searchGif', async () => {
        const query = await vscode.window.showInputBox({
            prompt: 'Search for GIFs',
            placeHolder: 'e.g. cat, celebration, coding'
        });

        if (query) {
            await gifViewProvider.searchGifs(query, 1);
            await vscode.commands.executeCommand('gifViewer.gifView.focus');
        }
    });

    context.subscriptions.push(setGifCommand);
    context.subscriptions.push(randomGifCommand);
    context.subscriptions.push(toggleAutoCommand);
    const pasteGifCommand = vscode.commands.registerCommand('gifViewer.pasteGif', async () => {
        await gifViewProvider.pasteFromClipboardText();
    });

    context.subscriptions.push(searchGifCommand);
    context.subscriptions.push(pasteGifCommand);

    // Watch for configuration changes (debounced so editing a URL
    // keystroke-by-keystroke doesn't trigger intermediate loads)
    let refreshTimer: NodeJS.Timeout | undefined;
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('gifViewer')) {
                if (refreshTimer) {
                    clearTimeout(refreshTimer);
                }
                refreshTimer = setTimeout(() => {
                    refreshTimer = undefined;
                    gifViewProvider.refresh();
                }, 800);
            }
        })
    );
}

export function deactivate() {
    if (gifViewProvider) {
        gifViewProvider.dispose();
    }
}
