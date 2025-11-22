/// <reference path="./storage.ts" />
/// <reference path="../utils.ts" />

type ThreadMetadata = {
    name?: string;
    tags?: string[];
    note?: string;
    size?: number;
    length?: number;
};

/**
 * Stores and retrieves per-thread metadata (name, tags, note, size).
 */
class ThreadMetadataService {
    private readonly prefix = '__tagalyst_thread__';

    constructor(private readonly storage: StorageService) { }

    async read(threadId: string): Promise<ThreadMetadata> {
        if (!threadId) return {};
        const key = this.buildKey(threadId);
        const record = await this.storage.read([key]);
        return (record && record[key]) || {};
    }

    async write(threadId: string, meta: ThreadMetadata): Promise<void> {
        if (!threadId) return;
        const key = this.buildKey(threadId);
        await this.storage.write({ [key]: meta || {} });
    }

    async updateSize(threadId: string, size: number): Promise<void> {
        if (!threadId) return;
        const existing = await this.read(threadId);
        existing.size = size;
        await this.write(threadId, existing);
    }

    async updateLength(threadId: string, length: number): Promise<void> {
        if (!threadId) return;
        const existing = await this.read(threadId);
        existing.length = length;
        await this.write(threadId, existing);
    }

    private buildKey(threadId: string) {
        return `${this.prefix}${threadId}`;
    }
}

/**
 * Derives a stable thread identifier from the URL or falls back to Utils.getThreadKey().
 */
function deriveThreadId(): string {
    const path = location.pathname || '';
    const match = path.match(/\/c\/([^/?#]+)/);
    if (match && match[1]) return match[1];
    return Utils.getThreadKey();
}

// Expose for global/script consumers
(globalThis as any).ThreadMetadataService = ThreadMetadataService;
(globalThis as any).deriveThreadId = deriveThreadId;
