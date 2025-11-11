export {};

declare global {
    /**
     * Basic summary of a message block within the ChatGPT transcript.
     */
    interface MessageAdapter {
        readonly key: string;
        readonly role: string;
        readonly element: HTMLElement;
        getText(): string;
        shouldShowCollapse(): boolean;
    }

    /**
     * Represents a (query, response) pair for navigation/export logic.
     */
    interface PairAdapter {
        readonly index: number;
        readonly query: MessageAdapter | null;
        readonly response: MessageAdapter | null;
        getMessages(): MessageAdapter[];
    }

    /**
     * Adapter responsible for discovering threads + observing DOM changes.
     * For the first refactor pass we expose raw DOM nodes; later this can return the richer adapters above.
     */
    interface ThreadAdapter {
        getTranscriptRoot(): HTMLElement | null;
        getMessages(root: HTMLElement): MessageAdapter[];
        getPairs(root: HTMLElement): PairAdapter[];
        getPromptMessages(root: HTMLElement): MessageAdapter[];
        getNavigationMessages(root: HTMLElement): MessageAdapter[];
        getPairAt(root: HTMLElement, index: number): PairAdapter | null;
        observe(root: HTMLElement, callback: MutationCallback): void;
        disconnect(): void;
    }

    interface ToolbarController {
        mount(): void;
        unmount(): void;
        jumpFocus(delta: number): void;
        collapseAll(state: boolean): void;
        collapseByFocus(target: 'in' | 'out', collapseState: boolean): void;
        exportMarkdown(focusOnly: boolean): void;
    }

    interface EditorController {
        openTagEditor(message: MessageAdapter): Promise<void>;
        openNoteEditor(message: MessageAdapter): Promise<void>;
        closeEditors(): void;
    }

    interface StorageService {
        get<T = unknown>(keys: string[]): Promise<Record<string, T>>;
        set<T = unknown>(items: Record<string, T>): Promise<void>;
        clear(): Promise<void>;
    }

    interface ConfigState {
        searchEnabled: boolean;
        tagsEnabled: boolean;
        [key: string]: unknown;
    }

    interface ConfigService {
        load(): Promise<ConfigState>;
        update(next: Partial<ConfigState>): Promise<ConfigState>;
        subscribe(listener: (state: ConfigState) => void): () => void;
    }
}
