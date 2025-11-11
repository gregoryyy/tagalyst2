export {};

declare global {
    interface ChromeStorageArea {
        get(keys: string[] | string | null, callback: (items: Record<string, unknown>) => void): void;
        set(items: Record<string, unknown>, callback?: () => void): void;
        clear(callback?: () => void): void;
    }

    interface ChromeStorageChange {
        newValue?: unknown;
        oldValue?: unknown;
    }

    interface ChromeStorage {
        local: ChromeStorageArea;
        onChanged: {
            addListener(callback: (changes: Record<string, ChromeStorageChange>, areaName: string) => void): void;
        };
    }

    interface Chrome {
        storage: ChromeStorage;
    }

    const chrome: Chrome;

    interface FileSystemWritableFileStream {
        write(data: string): Promise<void>;
        close(): Promise<void>;
    }

    interface FileSystemFileHandle {
        createWritable(): Promise<FileSystemWritableFileStream>;
    }

    interface FilePickerAcceptType {
        description?: string;
        accept?: Record<string, string[]>;
    }

    interface SaveFilePickerOptions {
        suggestedName?: string;
        types?: FilePickerAcceptType[];
    }

    interface TagalystPair {
        query: HTMLElement | null;
        response: HTMLElement | null;
        queryId: string | null;
        responseId: string | null;
    }

    interface TagalystApi {
        getThreadPairs(): TagalystPair[];
        getThreadPair(index: number): TagalystPair | null;
    }

    interface Window {
        __tagalyst?: TagalystApi;
        showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
    }
}
