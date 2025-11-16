/**
 * Provides DOM traversal helpers abstracted behind the ThreadAdapter interface.
 */
class ThreadDom {
    constructor(adapterProvider) {
        this.adapterProvider = adapterProvider;
    }
    /**
     * Locates the main scrollable transcript container.
     */
    findTranscriptRoot() {
        return this.adapterProvider()?.getTranscriptRoot() ?? ThreadDom.defaultFindTranscriptRoot();
    }
    /**
     * Returns DOM message elements within the provided root.
     */
    enumerateMessages(root) {
        const adapter = this.adapterProvider();
        if (adapter) {
            return adapter.getMessages(root).map(message => message.element);
        }
        return ThreadDom.defaultEnumerateMessages(root);
    }
    /**
     * Builds prompt/response pairs from the current transcript.
     */
    getPairs(root) {
        const adapter = this.adapterProvider();
        if (adapter)
            return adapter.getPairs(root).map(ThreadDom.toTagalystPair);
        return ThreadDom.defaultGetPairs(root);
    }
    /**
     * Returns nodes considered to be user prompts for navigation.
     */
    getPromptNodes(root) {
        const adapter = this.adapterProvider();
        if (adapter)
            return adapter.getPromptMessages(root).map(ad => ad.element);
        return ThreadDom.defaultGetPromptNodes(root);
    }
    /**
     * Returns nodes used for focus navigation (prompts or fallback messages).
     */
    getNavigationNodes(root) {
        const adapter = this.adapterProvider();
        if (adapter)
            return adapter.getNavigationMessages(root).map(ad => ad.element);
        return ThreadDom.defaultGetNavigationNodes(root);
    }
    /**
     * Returns the nth prompt/response pair.
     */
    getPair(root, idx) {
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
    buildPairAdaptersFromMessages(messages) {
        return ThreadDom.buildDomPairAdaptersFromMessages(messages);
    }
    static defaultFindTranscriptRoot() {
        const main = document.querySelector('main') || document.body;
        const candidates = Array.from(main.querySelectorAll('*')).filter(el => {
            const s = getComputedStyle(el);
            const scrollable = s.overflowY === 'auto' || s.overflowY === 'scroll';
            return scrollable && el.clientHeight > 300 && el.children.length > 1;
        });
        return (candidates.sort((a, b) => b.clientHeight - a.clientHeight)[0]) || main;
    }
    static isMessageNode(el) {
        if (!el)
            return false;
        return !!el.getAttribute?.('data-message-author-role');
    }
    static defaultEnumerateMessages(root) {
        const nodes = Array.from(root.querySelectorAll('[data-message-author-role]'));
        if (nodes.length)
            return nodes;
        const out = [];
        root.querySelectorAll('article, div').forEach(child => {
            if (ThreadDom.isMessageNode(child))
                out.push(child);
        });
        return out;
    }
    static defaultDerivePairs(messages) {
        const pairs = [];
        for (let i = 0; i < messages.length; i += 2) {
            const query = messages[i];
            if (!query)
                break;
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
    static defaultGetPairs(root) {
        return ThreadDom.defaultDerivePairs(ThreadDom.defaultEnumerateMessages(root));
    }
    static defaultGetPromptNodes(root) {
        return ThreadDom.defaultGetPairs(root).map(p => p.query).filter(Boolean);
    }
    static defaultGetNavigationNodes(root) {
        const prompts = ThreadDom.defaultGetPromptNodes(root);
        if (prompts.length)
            return prompts;
        return ThreadDom.defaultEnumerateMessages(root);
    }
    static defaultGetPair(root, idx) {
        if (idx < 0)
            return null;
        return ThreadDom.defaultGetPairs(root)[idx] || null;
    }
    static toTagalystPair(pair) {
        const queryEl = pair.query?.element || null;
        const responseEl = pair.response?.element || null;
        return {
            query: queryEl,
            response: responseEl,
            queryId: queryEl ? Utils.getMessageId(queryEl) : null,
            responseId: responseEl ? Utils.getMessageId(responseEl) : null,
        };
    }
    static buildDomPairAdaptersFromMessages(messages) {
        const pairs = [];
        for (let i = 0; i < messages.length; i += 2) {
            const query = messages[i] || null;
            const response = messages[i + 1] || null;
            pairs.push(new DomPairAdapter(pairs.length, query, response));
        }
        return pairs;
    }
} // ThreadDom
