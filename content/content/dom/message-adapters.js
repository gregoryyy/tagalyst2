/**
 * Default MessageAdapter implementation built around raw ChatGPT DOM nodes.
 */
class DomMessageAdapter {
    constructor(element) {
        this.element = element;
        this.textCache = null;
        this.key = Utils.keyForMessage(element);
        this.role = element.getAttribute('data-message-author-role') || 'unknown';
    }
    /**
     * Returns normalized text content without extension UI nodes.
     */
    getText() {
        if (this.textCache !== null)
            return this.textCache;
        const clone = this.element.cloneNode(true);
        clone.querySelectorAll(`[${EXT_ATTR}]`).forEach(node => node.remove());
        clone.querySelectorAll('.ext-toolbar-row').forEach(node => node.remove());
        const source = clone.textContent ?? clone.innerText ?? '';
        this.textCache = Utils.normalizeText(source);
        return this.textCache;
    }
    /**
     * Indicates whether collapse controls should render for this message.
     */
    shouldShowCollapse() {
        return true;
    }
    /**
     * Builds the storage key for this message instance.
     */
    storageKey(threadKey) {
        return `${threadKey}:${this.key}`;
    }
} // DomMessageAdapter
/**
 * Default PairAdapter mapping user/assistant message pairs for navigation/export.
 */
class DomPairAdapter {
    constructor(index, query, response) {
        this.index = index;
        this.query = query;
        this.response = response;
    }
    /**
     * Returns the defined messages, filtering out nulls.
     */
    getMessages() {
        return [this.query, this.response].filter(Boolean);
    }
} // DomPairAdapter
/**
 * Provides DOM traversal helpers abstracted behind the ThreadAdapter interface.
 */
