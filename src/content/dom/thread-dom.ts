/**
 * Provides DOM traversal helpers abstracted behind the ThreadAdapter interface.
 */
class ThreadDom {
    constructor(private readonly adapterProvider: () => ThreadAdapter | null) { }

    /**
     * Locates the main scrollable transcript container.
     */
    findTranscriptRoot(): HTMLElement {
        return this.adapterProvider()?.getTranscriptRoot() ?? ThreadDom.defaultFindTranscriptRoot();
    }

    /**
     * Returns DOM message elements within the provided root.
     */
    enumerateMessages(root: HTMLElement): HTMLElement[] {
        const adapter = this.adapterProvider();
        if (adapter) {
            return adapter.getMessages(root).map(message => message.element);
        }
        return ThreadDom.defaultEnumerateMessages(root);
    }

    /**
     * Builds prompt/response pairs from the current transcript.
     */
    getPairs(root: HTMLElement): TagalystPair[] {
        const adapter = this.adapterProvider();
        if (adapter) return adapter.getPairs(root).map(ThreadDom.toTagalystPair);
        return ThreadDom.defaultGetPairs(root);
    }

    /**
     * Returns nodes considered to be user prompts for navigation.
     */
    getPromptNodes(root: HTMLElement): HTMLElement[] {
        const adapter = this.adapterProvider();
        if (adapter) return adapter.getPromptMessages(root).map(ad => ad.element);
        return ThreadDom.defaultGetPromptNodes(root);
    }

    /**
     * Returns nodes used for focus navigation (prompts or fallback messages).
     */
    getNavigationNodes(root: HTMLElement): HTMLElement[] {
        const adapter = this.adapterProvider();
        if (adapter) return adapter.getNavigationMessages(root).map(ad => ad.element);
        return ThreadDom.defaultGetNavigationNodes(root);
    }

    /**
     * Returns the nth prompt/response pair.
     */
    getPair(root: HTMLElement, idx: number): TagalystPair | null {
        const adapter = this.adapterProvider();
        if (adapter) {
            const pair = adapter.getPairAt(root, idx);
            return pair ? ThreadDom.toTagalystPair(pair) : null;
        }
        return ThreadDom.defaultGetPair(root, idx);
    }

    /**
     * Builds pair adapters from a flat list of MessageAdapters.
     */
    buildPairAdaptersFromMessages(messages: MessageAdapter[]): DomPairAdapter[] {
        return ThreadDom.buildDomPairAdaptersFromMessages(messages);
    }

    static defaultFindTranscriptRoot(): HTMLElement {
        const main = (document.querySelector('main') as HTMLElement) || document.body;
        const messageNodes = Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="conversation-turn"], [data-message-author-role]'));

        // Prefer a scrollable ancestor of the conversation messages (avoids picking nav/sidebar).
        const ancestorCandidates = messageNodes
            .map(node => node.closest<HTMLElement>('main, section, article, div'))
            .filter(Boolean) as HTMLElement[];

        const scored = ancestorCandidates.map(el => {
            const s = getComputedStyle(el);
            const scrollable = s.overflowY === 'auto' || s.overflowY === 'scroll';
            const score = (scrollable ? 2 : 0) + (el.clientHeight || 0) / 1000;
            return { el, score };
        });

        if (scored.length) {
            scored.sort((a, b) => b.score - a.score);
            return scored[0].el;
        }

        // Fallback to a large scrollable region under main.
        const candidates = Array.from(main.querySelectorAll<HTMLElement>('*')).filter(el => {
            const s = getComputedStyle(el);
            const scrollable = s.overflowY === 'auto' || s.overflowY === 'scroll';
            return scrollable && el.clientHeight > 300 && el.children.length > 1;
        });
        return (candidates.sort((a, b) => b.clientHeight - a.clientHeight)[0]) || main;
    }

    private static isMessageNode(el: HTMLElement | null) {
        if (!el) return false;
        return !!el.getAttribute?.('data-message-author-role');
    }

    static defaultEnumerateMessages(root: HTMLElement): HTMLElement[] {
        const nodes = Array.from(root.querySelectorAll<HTMLElement>('[data-message-author-role]'));
        if (nodes.length) return nodes;
        const out: HTMLElement[] = [];
        root.querySelectorAll<HTMLElement>('article, div').forEach(child => {
            if (ThreadDom.isMessageNode(child)) out.push(child);
        });
        return out;
    }

    static defaultDerivePairs(messages: HTMLElement[]): TagalystPair[] {
        const pairs: TagalystPair[] = [];
        for (let i = 0; i < messages.length; i += 2) {
            const query = messages[i];
            if (!query) break;
            const response = messages[i + 1] || null;
            pairs.push({
                query,
                response,
                queryId: Utils.getMessageId(query),
                responseId: response ? Utils.getMessageId(response) : null,
            });
        }
        return pairs;
    }

    static defaultGetPairs(root: HTMLElement): TagalystPair[] {
        return ThreadDom.defaultDerivePairs(ThreadDom.defaultEnumerateMessages(root));
    }

    static defaultGetPromptNodes(root: HTMLElement): HTMLElement[] {
        return ThreadDom.defaultGetPairs(root).map(p => p.query).filter(Boolean) as HTMLElement[];
    }

    static defaultGetNavigationNodes(root: HTMLElement): HTMLElement[] {
        const prompts = ThreadDom.defaultGetPromptNodes(root);
        if (prompts.length) return prompts;
        return ThreadDom.defaultEnumerateMessages(root);
    }

    static defaultGetPair(root: HTMLElement, idx: number): TagalystPair | null {
        if (idx < 0) return null;
        return ThreadDom.defaultGetPairs(root)[idx] || null;
    }

    static toTagalystPair(pair: PairAdapter): TagalystPair {
        const queryEl = pair.query?.element || null;
        const responseEl = pair.response?.element || null;
        return {
            query: queryEl,
            response: responseEl,
            queryId: queryEl ? Utils.getMessageId(queryEl) : null,
            responseId: responseEl ? Utils.getMessageId(responseEl) : null,
        };
    }

    static buildDomPairAdaptersFromMessages(messages: MessageAdapter[]): DomPairAdapter[] {
        const pairs: DomPairAdapter[] = [];
        for (let i = 0; i < messages.length; i += 2) {
            const query = messages[i] || null;
            const response = messages[i + 1] || null;
            pairs.push(new DomPairAdapter(pairs.length, query, response));
        }
        return pairs;
    }
} // ThreadDom
