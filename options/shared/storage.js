export const tagalystStorage = {
    async read(keys) {
        if (Array.isArray(keys) && !keys.length)
            return {};
        return new Promise(resolve => chrome.storage.local.get(keys || null, resolve));
    },
    async write(record) {
        if (!record || !Object.keys(record).length)
            return;
        await new Promise(resolve => chrome.storage.local.set(record, () => resolve()));
    },
    async clear() {
        await new Promise(resolve => chrome.storage.local.clear(() => resolve()));
    },
    async readAll() {
        return this.read();
    },
};
globalThis.tagalystStorage = tagalystStorage;
