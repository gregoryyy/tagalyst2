/**
 * ThreadAdapter specialized for the current ChatGPT DOM structure.
 */
class ChatGptThreadAdapter implements ThreadAdapter {
    private observer: MutationObserver | null = null;

    getTranscriptRoot(): HTMLElement | null {
        return ThreadDom.defaultFindTranscriptRoot();
    }

    getMessages(root: HTMLElement): MessageAdapter[] {
        return this.buildMessageAdapters(root);
    }

    getPairs(root: HTMLElement): PairAdapter[] {
        return this.buildPairAdapters(root);
    }

    getPromptMessages(root: HTMLElement): MessageAdapter[] {
        return this.buildPairAdapters(root)
            .map(pair => pair.query)
            .filter(Boolean) as MessageAdapter[];
    }

    getNavigationMessages(root: HTMLElement): MessageAdapter[] {
        const prompts = this.getPromptMessages(root);
        if (prompts.length) return prompts;
        return this.buildMessageAdapters(root);
    }

    getPairAt(root: HTMLElement, index: number): PairAdapter | null {
        const pairs = this.buildPairAdapters(root);
        if (index < 0 || index >= pairs.length) return null;
        return pairs[index];
    }

    observe(root: HTMLElement, callback: MutationCallback): void {
        this.disconnect();
        this.observer = new MutationObserver(callback);
        this.observer.observe(root, { childList: true, subtree: true });
    }

    disconnect(): void {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
    }

    private buildMessageAdapters(root: HTMLElement): DomMessageAdapter[] {
        return ThreadDom.defaultEnumerateMessages(root).map(el => new DomMessageAdapter(el));
    }

    private buildPairAdapters(root: HTMLElement): DomPairAdapter[] {
        const messages = this.buildMessageAdapters(root);
        return ThreadDom.buildDomPairAdaptersFromMessages(messages);
    }
} // ChatGptThreadAdapter
