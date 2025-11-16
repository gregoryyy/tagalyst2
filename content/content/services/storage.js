/**
 * Thin wrapper around chrome.storage APIs for per-message persistence.
 */
class StorageService {
    /**
     * Reads a set of message keys from local storage.
     */
    async read(keys) {
        if (!Array.isArray(keys) || !keys.length)
            return {};
        return new Promise(resolve => chrome.storage.local.get(keys, resolve));
    }
    /**
     * Writes the provided record to chrome.storage.
     */
    async write(record) {
        if (!record || !Object.keys(record).length)
            return;
        await new Promise(resolve => chrome.storage.local.set(record, () => resolve()));
    }
    /**
     * Derives the storage key for a specific message.
     */
    keyForMessage(threadKey, adapter) {
        return adapter.storageKey(threadKey);
    }
    /**
     * Reads a single message entry identified by thread/message keys.
     */
    async readMessage(threadKey, adapter) {
        const key = this.keyForMessage(threadKey, adapter);
        const record = await this.read([key]);
        return record[key] || {};
    }
    /**
     * Persists a single message entry identified by thread/message keys.
     */
    async writeMessage(threadKey, adapter, value) {
        const key = this.keyForMessage(threadKey, adapter);
        await this.write({ [key]: value });
    }
} // StorageService
