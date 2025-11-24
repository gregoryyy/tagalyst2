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
    constructor(private readonly threadDom: ThreadDom) { }

    buildTranscript(container: HTMLElement, adapter: ThreadAdapter | null): TranscriptSnapshot {
        const messages = this.resolveMessages(container, adapter);
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
        return { messages: messages.map(m => this.wrap(m)), pairs, pairIndexByMessage };
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
} // TranscriptService

(globalThis as any).TranscriptService = TranscriptService;
