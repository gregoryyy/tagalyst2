/// <reference path="../dom/thread-dom.ts" />
/// <reference path="../../types/domain.d.ts" />
/// <reference path="../../types/globals.d.ts" />

type TranscriptMessage = {
    id: string | null;
    role: string;
    text: string;
    adapter: MessageAdapter;
};

type TranscriptPair = {
    index: number;
    query: TranscriptMessage | null;
    response: TranscriptMessage | null;
};

type TranscriptSnapshot = {
    messages: TranscriptMessage[];
    pairs: TranscriptPair[];
    pairIndexByMessage: Map<MessageAdapter, number>;
};

/**
 * Produces a normalized transcript view (messages + pairs) from the active adapter.
 */
class TranscriptService {
    private lastSnapshot: TranscriptSnapshot | null = null;
    private lastDigest = '';

    constructor(private readonly threadDom: ThreadDom) { }

    buildTranscript(container: HTMLElement, adapter: ThreadAdapter | null): TranscriptSnapshot {
        const messages = this.resolveMessages(container, adapter);
        const digest = this.computeDigest(messages);
        if (this.lastSnapshot && digest === this.lastDigest) {
            return this.lastSnapshot;
        }
        const pairs = this.threadDom.buildPairAdaptersFromMessages(messages).map(pair => {
            const query = pair.query ? this.wrap(pair.query) : null;
            const response = pair.response ? this.wrap(pair.response) : null;
            return { index: pair.index, query, response };
        });
        const pairIndexByMessage = new Map<MessageAdapter, number>();
        pairs.forEach(pair => {
            if (pair.query) pairIndexByMessage.set(pair.query.adapter, pair.index);
            if (pair.response) pairIndexByMessage.set(pair.response.adapter, pair.index);
        });
        this.lastSnapshot = { messages: messages.map(m => this.wrap(m)), pairs, pairIndexByMessage };
        this.lastDigest = digest;
        return this.lastSnapshot;
    }

    private resolveMessages(container: HTMLElement, adapter: ThreadAdapter | null): MessageAdapter[] {
        return (adapter
            ? adapter.getMessages(container)
            : ThreadDom.defaultEnumerateMessages(container).map(el => new DomMessageAdapter(el)));
    }

    private wrap(adapter: MessageAdapter): TranscriptMessage {
        let text = '';
        try {
            text = adapter.getText();
        } catch {
            text = adapter.element?.innerText || '';
        }
        return {
            id: adapter.element?.getAttribute?.('data-message-id') || adapter.key,
            role: adapter.role,
            text,
            adapter,
        };
    }

    /**
     * Builds a lightweight digest of message identity + text length/hash to detect DOM changes without getText().
     */
    private computeDigest(messages: MessageAdapter[]): string {
        return messages.map(m => {
            const id = this.getId(m);
            const role = m.role || '';
            const text = this.safeTextContent(m);
            return `${role}:${id}:${text.length}:${this.fastHash(text)}`;
        }).join('|');
    }

    private getId(adapter: MessageAdapter) {
        return adapter.element?.getAttribute?.('data-message-id') || adapter.key || '';
    }

    private safeTextContent(adapter: MessageAdapter) {
        return adapter.element?.textContent || '';
    }

    private fastHash(str: string) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return hash >>> 0;
    }
} // TranscriptService

(globalThis as any).TranscriptService = TranscriptService;
