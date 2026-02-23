import * as crypto from 'crypto';
import { KLIPY_APP_KEY } from './secrets';

export interface GifApiResponse {
    url: string;
    title?: string;
}

interface KlipyGifFile {
    gif: { url: string; width: number; height: number; size: number; };
    webp: { url: string; width: number; height: number; size: number; };
    mp4: { url: string; width: number; height: number; size: number; };
}

interface KlipyGifData {
    id: number;
    slug: string;
    title: string;
    file: {
        hd: KlipyGifFile;
        md: KlipyGifFile;
        sm: KlipyGifFile;
        xs: KlipyGifFile;
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

export class GifService {
    private static readonly KLIPY_BASE_URL = 'https://api.klipy.com';
    private customerId: string;

    constructor() {
        // Generate a unique customer ID for this installation
        this.customerId = this.generateCustomerId();
    }

    /**
     * Generates a unique customer ID for this VSCode installation
     */
    private generateCustomerId(): string {
        const randomBytes = crypto.randomBytes(16);
        return crypto.createHash('sha256').update(randomBytes).digest('hex').substring(0, 32);
    }

    /**
     * Fetches a random GIF from Klipy.
     * Uses tag search if a tag is provided, otherwise falls back to trending.
     */
    async getRandomGif(tag: string, apiKey?: string): Promise<GifApiResponse> {
        const appKey = apiKey || KLIPY_APP_KEY;

        if (tag && tag.trim() !== '') {
            return this.searchRandomGif(appKey, tag);
        } else {
            return this.getTrendingRandomGif(appKey);
        }
    }

    /**
     * Searches for a random GIF by tag
     */
    private async searchRandomGif(appKey: string, query: string): Promise<GifApiResponse> {
        try {
            const url = `${GifService.KLIPY_BASE_URL}/api/v1/${appKey}/gifs/search?customer_id=${this.customerId}&q=${encodeURIComponent(query)}&per_page=50`;

            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Klipy API error: ${response.status}`);
            }

            const data = await response.json() as KlipyResponse;

            if (!data.result || !data.data.data || data.data.data.length === 0) {
                throw new Error('No GIFs found from Klipy');
            }

            // Pick a random GIF from the results
            const randomIndex = Math.floor(Math.random() * data.data.data.length);
            const gif = data.data.data[randomIndex];

            return {
                url: gif.file.md.gif.url, // Medium quality
                title: gif.title || 'Random GIF'
            };
        } catch (error) {
            console.error('Error searching GIFs from Klipy:', error);
            throw new Error(`Failed to search GIF from Klipy: ${error}`);
        }
    }

    /**
     * Fetches a random GIF from the trending list
     */
    private async getTrendingRandomGif(appKey: string): Promise<GifApiResponse> {
        try {
            const url = `${GifService.KLIPY_BASE_URL}/api/v1/${appKey}/gifs/trending?customer_id=${this.customerId}&per_page=50`;

            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Klipy API error: ${response.status}`);
            }

            const data = await response.json() as KlipyResponse;

            if (!data.result || !data.data.data || data.data.data.length === 0) {
                throw new Error('No trending GIFs found from Klipy');
            }

            // Pick a random GIF from the trending list
            const randomIndex = Math.floor(Math.random() * data.data.data.length);
            const gif = data.data.data[randomIndex];

            return {
                url: gif.file.md.gif.url, // Medium quality
                title: gif.title || 'Trending GIF'
            };
        } catch (error) {
            console.error('Error fetching trending GIFs from Klipy:', error);
            throw new Error(`Failed to fetch trending GIF from Klipy: ${error}`);
        }
    }

    /**
     * Checks whether a GIF URL is reachable
     */
    async validateGifUrl(url: string): Promise<boolean> {
        try {
            const response = await fetch(url, { method: 'HEAD' });
            return response.ok;
        } catch {
            return false;
        }
    }
}
