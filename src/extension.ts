import * as vscode from 'vscode';
import { GifService } from './gifService';

const DEFAULT_GIF = 'https://media.giphy.com/media/artj92V8o75VPL7AeQ/giphy.gif';

let gifViewProvider: GifViewProvider;

class GifViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'gifViewer.gifView';
    private _view?: vscode.WebviewView;
    private _extensionUri: vscode.Uri;
    private _currentGif: string = '';
    private _gifService: GifService;
    private _context: vscode.ExtensionContext;
    private _autoChangeTimer?: NodeJS.Timeout;
    private _isAutoMode: boolean = false;

    constructor(extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
        this._extensionUri = extensionUri;
        this._context = context;
        this._gifService = new GifService();
        this._currentGif = context.globalState.get<string>('lastGifUrl') || this._getGif();
        this._checkAndStartAutoMode();
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        // Only reset to manual GIF if in manual mode and no GIF is loaded yet
        const config = vscode.workspace.getConfiguration('gifViewer');
        const mode = config.get<string>('mode') || 'manual';

        if (mode === 'manual' && !this._currentGif) {
            this._currentGif = this._getGif();
        }

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
            }
        });

        // When the view becomes visible again, check the current mode
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this._checkAndStartAutoMode();
            }
        });
    }

    private _getGif(): string {
        const config = vscode.workspace.getConfiguration('gifViewer');
        return config.get<string>('gifUrl') || DEFAULT_GIF;
    }

    private _checkAndStartAutoMode(): void {
        const config = vscode.workspace.getConfiguration('gifViewer');
        const mode = config.get<string>('mode') || 'manual';

        if (mode === 'auto') {
            this.startAutoChange();
        } else {
            this.stopAutoChange();
        }
    }

    public setGif(url: string) {
        this._currentGif = url;
        this._context.globalState.update('lastGifUrl', url);
        if (this._view) {
            this._view.webview.postMessage({ type: 'setGif', gifUrl: url });
        }
    }

    public async loadRandomGif(): Promise<void> {
        try {
            const config = vscode.workspace.getConfiguration('gifViewer');
            const searchTag = config.get<string>('searchTag') || 'celebration';
            const apiKey = config.get<string>('apiKey') || '';

            if (this._view) {
                this._view.webview.postMessage({ type: 'loading', isLoading: true });
            }

            const gifData = await this._gifService.getRandomGif(searchTag, apiKey);
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
            const perPage = config.get<number>('resultsPerPage') || 12;

            if (this._view) {
                this._view.webview.postMessage({ type: 'searchLoading', isLoading: true });
            }

            const result = await this._gifService.searchGifs(query, page, perPage, apiKey);

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

        // Load first GIF immediately
        this.loadRandomGif();

        // Set up timer for automatic changes
        this._autoChangeTimer = setInterval(() => {
            this.loadRandomGif();
        }, interval * 1000);

        if (this._view) {
            this._view.webview.postMessage({ type: 'autoModeStatus', isActive: true });
        }

        vscode.window.showInformationMessage(`Auto change enabled (every ${interval}s)`);
    }

    public stopAutoChange(): void {
        if (this._autoChangeTimer) {
            clearInterval(this._autoChangeTimer);
            this._autoChangeTimer = undefined;
            this._isAutoMode = false;

            if (this._view) {
                this._view.webview.postMessage({ type: 'autoModeStatus', isActive: false });
            }

            vscode.window.showInformationMessage('Auto change disabled');
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
        const config = vscode.workspace.getConfiguration('gifViewer');
        const mode = config.get<string>('mode') || 'manual';

        if (mode === 'manual') {
            this._currentGif = this._getGif();
        }

        this._checkAndStartAutoMode();

        if (this._view) {
            this._updateWebviewContent();
        }
    }

    private _updateWebviewContent() {
        if (!this._view) {
            return;
        }

        const config = vscode.workspace.getConfiguration('gifViewer');
        const mode = config.get<string>('mode') || 'manual';

        if (mode === 'manual') {
            this._view.webview.postMessage({
                type: 'setGif',
                gifUrl: this._currentGif
            });
        }
    }

    public dispose() {
        this.stopAutoChange();
    }

    private _getHtmlContent(): string {
        const config = vscode.workspace.getConfiguration('gifViewer');
        const mode = config.get<string>('mode') || 'manual';
        const showControls = mode !== 'manual';

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

        .gif-container {
            width: 100%;
            flex: 1;
            min-height: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
        }

        .gif-wrapper {
            width: 100%;
            height: 100%;
            position: relative;
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
            display: ${showControls ? 'flex' : 'none'};
            gap: 8px;
            justify-content: center;
            background: var(--vscode-sideBar-background);
            border-top: 1px solid var(--vscode-panel-border);
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
    </style>
</head>
<body>
    <div class="search-bar">
        <input type="text" id="searchInput" placeholder="Search GIFs..." />
        <button class="clear-btn" id="clearBtn" title="Clear search">
            <i class="codicon codicon-close"></i>
        </button>
    </div>

    <div class="gif-container">
        <div class="gif-wrapper">
            <img id="gif" src="${this._currentGif}" alt="GIF" />
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
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const gifElement = document.getElementById('gif');
        const loadingIndicator = document.getElementById('loadingIndicator');
        const randomBtn = document.getElementById('randomBtn');
        const autoBtn = document.getElementById('autoBtn');
        const searchInput = document.getElementById('searchInput');
        const clearBtn = document.getElementById('clearBtn');
        const resultsContainer = document.getElementById('resultsContainer');
        const resultsGrid = document.getElementById('resultsGrid');
        const searchLoading = document.getElementById('searchLoading');
        const searchStatus = document.getElementById('searchStatus');
        const loadMoreBtn = document.getElementById('loadMoreBtn');

        let currentSearchQuery = '';
        let currentSearchPage = 1;
        let debounceTimer = null;

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

        window.addEventListener('message', event => {
            const message = event.data;

            switch (message.type) {
                case 'setGif':
                    gifElement.src = message.gifUrl;
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
    context.subscriptions.push(searchGifCommand);

    // Watch for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('gifViewer')) {
                gifViewProvider.refresh();
            }
        })
    );
}

export function deactivate() {
    if (gifViewProvider) {
        gifViewProvider.dispose();
    }
}
