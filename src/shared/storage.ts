/**
 * Shared storage helpers wrapping chrome.storage.local for Tagalyst.
 */
export type TagalystStorageRecord = Record<string, any>;
export interface TagalystStorageApi {
    read(keys?: string[]): Promise<TagalystStorageRecord>;
    write(record: TagalystStorageRecord): Promise<void>;
    clear(): Promise<void>;
    readAll(): Promise<TagalystStorageRecord>;
}

export const tagalystStorage: TagalystStorageApi = {
    async read(keys?: string[]): Promise<TagalystStorageRecord> {
        if (Array.isArray(keys) && !keys.length) return {};
        return new Promise(resolve => chrome.storage.local.get(keys || null, resolve));
    },

    async write(record: TagalystStorageRecord): Promise<void> {
        if (!record || !Object.keys(record).length) return;
        await new Promise<void>(resolve => chrome.storage.local.set(record, () => resolve()));
    },

    async clear(): Promise<void> {
        await new Promise<void>(resolve => chrome.storage.local.clear(() => resolve()));
    },

    async readAll(): Promise<TagalystStorageRecord> {
        return this.read();
    },
};

(globalThis as any).tagalystStorage = tagalystStorage;

declare global {
    const tagalystStorage: TagalystStorageApi;
}
