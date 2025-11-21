/**
 * Default MessageAdapter implementation built around raw ChatGPT DOM nodes.
 */
class DomMessageAdapter implements MessageAdapter {
    readonly key: string;
    readonly role: string;
    private textCache: string | null = null;

    constructor(readonly element: HTMLElement) {
        this.key = Utils.keyForMessage(element);
        this.role = element.getAttribute('data-message-author-role') || 'unknown';
    }

    /**
     * Returns normalized text content without extension UI nodes.
     */
    getText(): string {
        if (this.textCache !== null) return this.textCache;
        const clone = this.element.cloneNode(true) as HTMLElement;
        clone.querySelectorAll(`[${EXT_ATTR}]`).forEach(node => node.remove());
        clone.querySelectorAll('.ext-toolbar-row').forEach(node => node.remove());
        const source = clone.textContent ?? clone.innerText ?? '';
        this.textCache = Utils.normalizeText(source);
        return this.textCache;
    }

    /**
     * Indicates whether collapse controls should render for this message.
     */
    shouldShowCollapse(): boolean {
        return true;
    }

    /**
     * Builds the storage key for this message instance.
     */
    storageKey(threadKey: string): string {
        return `${threadKey}:${this.key}`;
    }
} // DomMessageAdapter

/**
 * Default PairAdapter mapping user/assistant message pairs for navigation/export.
 */
class DomPairAdapter implements PairAdapter {
    constructor(
        readonly index: number,
        readonly query: MessageAdapter | null,
        readonly response: MessageAdapter | null,
    ) { }

    /**
     * Returns the defined messages, filtering out nulls.
     */
    getMessages(): MessageAdapter[] {
        return [this.query, this.response].filter(Boolean) as MessageAdapter[];
    }
} // DomPairAdapter

/**
 * Provides DOM traversal helpers abstracted behind the ThreadAdapter interface.
 */
