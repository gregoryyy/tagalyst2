/**
 * ThreadAdapter specialized for the current ChatGPT DOM structure.
 */
class ChatGptThreadAdapter {
    constructor() {
        this.observer = null;
    }
    getTranscriptRoot() {
        return ThreadDom.defaultFindTranscriptRoot();
    }
    getMessages(root) {
        return this.buildMessageAdapters(root);
    }
    getPairs(root) {
        return this.buildPairAdapters(root);
    }
    getPromptMessages(root) {
        return this.buildPairAdapters(root)
            .map(pair => pair.query)
            .filter(Boolean);
    }
    getNavigationMessages(root) {
        const prompts = this.getPromptMessages(root);
        if (prompts.length)
            return prompts;
        return this.buildMessageAdapters(root);
    }
    getPairAt(root, index) {
        const pairs = this.buildPairAdapters(root);
        if (index < 0 || index >= pairs.length)
            return null;
        return pairs[index];
    }
    observe(root, callback) {
        this.disconnect();
        this.observer = new MutationObserver(callback);
        this.observer.observe(root, { childList: true, subtree: true });
    }
    disconnect() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
    }
    buildMessageAdapters(root) {
        return ThreadDom.defaultEnumerateMessages(root).map(el => new DomMessageAdapter(el));
    }
    buildPairAdapters(root) {
        const messages = this.buildMessageAdapters(root);
        return ThreadDom.buildDomPairAdaptersFromMessages(messages);
    }
} // ChatGptThreadAdapter
