import * as vscode from 'vscode';
import { GifService } from './gifService';

const DEFAULT_GIF = 'https://media.giphy.com/media/artj92V8o75VPL7AeQ/giphy.gif';

let gifViewProvider: GifViewProvider;

class GifViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'gifViewer.gifView';
    private _view?: vscode.WebviewView;
    private _extensionUri: vscode.Uri;
    private _currentGif: string = '';
    private _width: string = '100%';
    private _height: string = '150px';
    private _gifService: GifService;
    private _autoChangeTimer?: NodeJS.Timeout;
    private _isAutoMode: boolean = false;

    constructor(extensionUri: vscode.Uri) {
        this._extensionUri = extensionUri;
        this._gifService = new GifService();
        this._currentGif = this._getGif();
        this._loadSize();
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

    private _loadSize(): void {
        const config = vscode.workspace.getConfiguration('gifViewer');
        this._width = config.get<string>('width') || '100%';
        this._height = config.get<string>('height') || '150px';
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
        if (this._view) {
            this._view.webview.postMessage({ type: 'setGif', gifUrl: url });
        }
    }

    public updateSize(width: string, height: string) {
        this._width = width;
        this._height = height;
        if (this._view) {
            this._view.webview.postMessage({ type: 'setSize', width, height });
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

    public startAutoChange(): void {
        if (this._autoChangeTimer) {
            return; // Already running
        }

        const config = vscode.workspace.getConfiguration('gifViewer');
        const interval = config.get<number>('autoChangeInterval') || 30;

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

        this._loadSize();

        // Only update to manual GIF when in manual mode
        // In random/auto mode, keep the current GIF
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

        // Send size update
        this._view.webview.postMessage({
            type: 'setSize',
            width: this._width,
            height: this._height
        });

        // Only update GIF if in manual mode
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
            align-items: center;
            justify-content: center;
            background: transparent;
            overflow: hidden;
            font-family: var(--vscode-font-family);
        }

        .gif-container {
            width: 100%;
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
        }

        .gif-wrapper {
            width: 100%;
            position: relative;
        }

        .gif-wrapper img {
            width: ${this._width};
            height: ${this._height};
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

        .controls button .codicon {
            font-size: 14px;
        }
    </style>
</head>
<body>
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

    <script>
        const vscode = acquireVsCodeApi();
        const gifElement = document.getElementById('gif');
        const loadingIndicator = document.getElementById('loadingIndicator');
        const randomBtn = document.getElementById('randomBtn');
        const autoBtn = document.getElementById('autoBtn');

        randomBtn?.addEventListener('click', () => {
            vscode.postMessage({ type: 'randomGif' });
        });

        autoBtn?.addEventListener('click', () => {
            vscode.postMessage({ type: 'toggleAuto' });
        });

        window.addEventListener('message', event => {
            const message = event.data;

            switch (message.type) {
                case 'setGif':
                    gifElement.src = message.gifUrl;
                    break;

                case 'setSize':
                    gifElement.style.width = message.width;
                    gifElement.style.height = message.height;
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
            }
        });
    </script>
</body>
</html>`;
    }
}

export function activate(context: vscode.ExtensionContext) {
    gifViewProvider = new GifViewProvider(context.extensionUri);

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

    context.subscriptions.push(setGifCommand);
    context.subscriptions.push(randomGifCommand);
    context.subscriptions.push(toggleAutoCommand);

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
