/// <reference path="../../shared/storage.ts" />

type MessageValue = Record<string, any>;

/**
 * Thin wrapper around chrome.storage APIs for per-message persistence.
 */
class StorageService {
    /**
     * Reads a set of message keys from local storage.
     */
    async read(keys: string[]): Promise<Record<string, MessageValue>> {
        if (!Array.isArray(keys) || !keys.length) return {};
        return tagalystStorage.read(keys);
    }

    /**
     * Writes the provided record to chrome.storage.
     */
    async write(record: Record<string, MessageValue>): Promise<void> {
        await tagalystStorage.write(record);
    }

    /**
     * Derives the storage key for a specific message.
     */
    keyForMessage(threadKey: string, adapter: MessageAdapter): string {
        return adapter.storageKey(threadKey);
    }

    /**
     * Reads a single message entry identified by thread/message keys.
     */
    async readMessage(threadKey: string, adapter: MessageAdapter): Promise<MessageValue> {
        const key = this.keyForMessage(threadKey, adapter);
        const record = await this.read([key]);
        return record[key] || {};
    }

    /**
     * Persists a single message entry identified by thread/message keys.
     */
    async writeMessage(threadKey: string, adapter: MessageAdapter, value: MessageValue): Promise<void> {
        const key = this.keyForMessage(threadKey, adapter);
        await this.write({ [key]: value });
    }
} // StorageService
