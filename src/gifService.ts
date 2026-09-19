import * as crypto from 'crypto';
import { KLIPY_APP_KEY } from './secrets';

export type ContentType = 'all' | 'gifs' | 'stickers';
type MediaKind = 'gifs' | 'stickers';

export interface GifApiResponse {
    url: string;
    thumbnail?: string;
    title?: string;
}

export interface GifSearchResult {
    gifs: GifApiResponse[];
    page: number;
    hasNext: boolean;
}

export interface GifRecentStore {
    getRecent(): string[];
    setRecent(urls: string[]): void;
    getCustomerId(): string | undefined;
    setCustomerId(id: string): void;
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

interface KlipyGifData {
    id: number;
    slug: string;
    title: string;
    file: {
        hd?: KlipySize;
        md?: KlipySize;
        sm?: KlipySize;
        xs?: KlipySize;
    };
    tags: string[];
    type: string;
}

interface KlipyResponse {
    result: boolean;
    data: {
        data: KlipyGifData[];
        current_page: number;
        per_page: number;
        has_next: boolean;
    };
}

interface KlipyPage {
    gifs: KlipyGifData[];
    page: number;
    hasNext: boolean;
}

interface RandomPool {
    key: string;
    query: string;
    appKey: string;
    contentType: MediaKind;
    deck: GifApiResponse[];
    nextPage: number;
    hasNext: boolean;
}

export class GifService {
    private static readonly KLIPY_BASE_URL = 'https://api.klipy.com';
    private static readonly POOL_PER_PAGE = 50;
    private static readonly MAX_RECENT = 30;
    private customerId: string;
    private _recentGifs: string[] = [];
    private _store?: GifRecentStore;
    private _pools = new Map<string, RandomPool>();
    private _randomTail: Promise<unknown> = Promise.resolve();

    constructor(store?: GifRecentStore) {
        this._store = store;
        const recent = store?.getRecent();
        this._recentGifs = Array.isArray(recent)
            ? recent.filter((url): url is string => typeof url === 'string').slice(-GifService.MAX_RECENT)
            : [];
        const existingId = store?.getCustomerId();
        if (existingId) {
            this.customerId = existingId;
        } else {
            this.customerId = this.generateCustomerId();
            store?.setCustomerId(this.customerId);
        }
    }

    private generateCustomerId(): string {
        const randomBytes = crypto.randomBytes(16);
        return crypto.createHash('sha256').update(randomBytes).digest('hex').substring(0, 32);
    }

    private async fetchKlipyPage(url: string): Promise<KlipyPage> {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Klipy API error: ${response.status}`);
        }
        const data = await response.json() as KlipyResponse;
        if (!data.result || !data.data || !data.data.data) {
            return { gifs: [], page: 1, hasNext: false };
        }
        return {
            gifs: data.data.data,
            page: data.data.current_page,
            hasNext: Boolean(data.data.has_next)
        };
    }

    private pickImageUrl(size?: KlipySize): string | undefined {
        return size?.gif?.url || size?.webp?.url || size?.png?.url;
    }

    private toApiResponse(gif: KlipyGifData, fallbackTitle: string): GifApiResponse | null {
        const url = this.pickImageUrl(gif.file?.md);
        if (!url) {
            return null;
        }
        return {
            url,
            thumbnail: this.pickImageUrl(gif.file?.sm),
            title: gif.title || fallbackTitle
        };
    }

    private shuffle<T>(items: T[]): T[] {
        for (let i = items.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [items[i], items[j]] = [items[j], items[i]];
        }
        return items;
    }

    private interleave<T>(a: T[], b: T[]): T[] {
        const out: T[] = [];
        const max = Math.max(a.length, b.length);
        for (let i = 0; i < max; i++) {
            if (i < a.length) {
                out.push(a[i]);
            }
            if (i < b.length) {
                out.push(b[i]);
            }
        }
        return out;
    }

    private rememberUrl(url: string): void {
        this._recentGifs = this._recentGifs.filter(item => item !== url);
        this._recentGifs.push(url);
        while (this._recentGifs.length > GifService.MAX_RECENT) {
            this._recentGifs.shift();
        }
        this._store?.setRecent(this._recentGifs);
    }

    private poolKey(tag: string, kind: MediaKind): { key: string; query: string } {
        const query = tag.trim();
        if (!query) {
            return { key: `${kind}:trending`, query: '' };
        }
        return { key: `${kind}:search:${query.toLowerCase()}`, query };
    }

    private async fetchRandomPage(pool: RandomPool, requestedPage: number): Promise<KlipyPage> {
        const perPage = GifService.POOL_PER_PAGE;
        const common = `customer_id=${this.customerId}&per_page=${perPage}&page=${requestedPage}`;
        const url = pool.query
            ? `${GifService.KLIPY_BASE_URL}/api/v1/${pool.appKey}/${pool.contentType}/search?${common}&q=${encodeURIComponent(pool.query)}`
            : `${GifService.KLIPY_BASE_URL}/api/v1/${pool.appKey}/${pool.contentType}/trending?${common}`;
        return this.fetchKlipyPage(url);
    }

    private async ensureDeck(pool: RandomPool, fallbackTitle: string): Promise<void> {
        let wrapped = false;
        while (pool.deck.length === 0) {
            const requestedPage = pool.nextPage;
            const page = await this.fetchRandomPage(pool, requestedPage);
            if (page.gifs.length === 0) {
                if (requestedPage === 1 || wrapped) {
                    throw new Error('No results found from Klipy');
                }
                wrapped = true;
                pool.nextPage = 1;
                pool.hasNext = true;
                continue;
            }
            const mapped = this.shuffle(
                page.gifs
                    .map(gif => this.toApiResponse(gif, fallbackTitle))
                    .filter((gif): gif is GifApiResponse => gif !== null)
            );
            if (mapped.length === 0) {
                if (requestedPage === 1 || wrapped) {
                    throw new Error('No results found from Klipy');
                }
                wrapped = true;
                pool.nextPage = 1;
                pool.hasNext = true;
                continue;
            }
            const fresh = mapped.filter(gif => !this._recentGifs.includes(gif.url));
            pool.deck = fresh.length > 0 ? fresh : mapped;
            pool.hasNext = page.hasNext;
            pool.nextPage = page.hasNext ? requestedPage + 1 : 1;
        }
    }

    private async dealRandomFromKind(tag: string, apiKey: string | undefined, kind: MediaKind): Promise<GifApiResponse> {
        const appKey = apiKey || KLIPY_APP_KEY;
        const { key, query } = this.poolKey(tag, kind);
        let pool = this._pools.get(key);
        if (!pool || pool.appKey !== appKey) {
            pool = { key, query, appKey, contentType: kind, deck: [], nextPage: 1, hasNext: true };
            this._pools.set(key, pool);
        }
        const fallbackTitle = query ? 'Random' : 'Trending';
        await this.ensureDeck(pool, fallbackTitle);
        const gif = pool.deck.shift();
        if (!gif) {
            throw new Error('No results found from Klipy');
        }
        this.rememberUrl(gif.url);
        return gif;
    }

    private splitSearchTags(tag: string): string[] {
        return tag.split(',').map(part => part.trim()).filter(part => part.length > 0);
    }

    private async dealRandomQuery(query: string, apiKey: string | undefined, contentType: ContentType): Promise<GifApiResponse> {
        if (contentType === 'gifs' || contentType === 'stickers') {
            return this.dealRandomFromKind(query, apiKey, contentType);
        }
        const kind: MediaKind = Math.random() < 0.5 ? 'gifs' : 'stickers';
        try {
            return await this.dealRandomFromKind(query, apiKey, kind);
        } catch {
            const fallback: MediaKind = kind === 'gifs' ? 'stickers' : 'gifs';
            return this.dealRandomFromKind(query, apiKey, fallback);
        }
    }

    private async dealRandom(tag: string, apiKey: string | undefined, contentType: ContentType): Promise<GifApiResponse> {
        const tags = this.splitSearchTags(tag);
        const queries = tags.length > 0 ? this.shuffle([...tags]) : [''];
        let lastError: unknown;
        for (const query of queries) {
            try {
                return await this.dealRandomQuery(query, apiKey, contentType);
            } catch (error) {
                lastError = error;
            }
        }
        throw lastError instanceof Error ? lastError : new Error('No results found from Klipy');
    }

    async getRandomGif(tag: string, apiKey?: string, contentType: ContentType = 'all'): Promise<GifApiResponse> {
        const run = this._randomTail.then(() => this.dealRandom(tag, apiKey, contentType));
        this._randomTail = run.then(() => undefined, () => undefined);
        return run;
    }

    private async searchKind(
        kind: MediaKind,
        query: string,
        page: number,
        perPage: number,
        appKey: string
    ): Promise<GifSearchResult> {
        const url = `${GifService.KLIPY_BASE_URL}/api/v1/${appKey}/${kind}/search?customer_id=${this.customerId}&q=${encodeURIComponent(query)}&per_page=${perPage}&page=${page}`;
        const pageData = await this.fetchKlipyPage(url);
        const gifs = pageData.gifs
            .map(gif => this.toApiResponse(gif, gif.title || 'GIF'))
            .filter((gif): gif is GifApiResponse => gif !== null);
        return {
            gifs,
            page: pageData.page || page,
            hasNext: pageData.hasNext
        };
    }

    async searchGifs(
        query: string,
        page: number,
        perPage: number,
        apiKey?: string,
        contentType: ContentType = 'all'
    ): Promise<GifSearchResult> {
        const appKey = apiKey || KLIPY_APP_KEY;

        try {
            if (contentType === 'gifs' || contentType === 'stickers') {
                return this.searchKind(contentType, query, page, perPage, appKey);
            }

            const [gifResult, stickerResult] = await Promise.allSettled([
                this.searchKind('gifs', query, page, perPage, appKey),
                this.searchKind('stickers', query, page, perPage, appKey)
            ]);
            const gifPage = gifResult.status === 'fulfilled'
                ? gifResult.value
                : { gifs: [], page, hasNext: false };
            const stickerPage = stickerResult.status === 'fulfilled'
                ? stickerResult.value
                : { gifs: [], page, hasNext: false };

            if (gifPage.gifs.length === 0 && stickerPage.gifs.length === 0) {
                if (gifResult.status === 'rejected' && stickerResult.status === 'rejected') {
                    throw gifResult.reason;
                }
                return { gifs: [], page, hasNext: false };
            }

            return {
                gifs: this.interleave(gifPage.gifs, stickerPage.gifs),
                page,
                hasNext: gifPage.hasNext || stickerPage.hasNext
            };
        } catch (error) {
            console.error('Error searching from Klipy:', error);
            throw new Error(`Failed to search from Klipy: ${error}`);
        }
    }

    async validateGifUrl(url: string): Promise<boolean> {
        try {
            const response = await fetch(url, { method: 'HEAD' });
            return response.ok;
        } catch {
            return false;
        }
    }
}
