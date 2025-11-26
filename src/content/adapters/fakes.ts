/// <reference path="../dom/message-adapters.ts" />
/// <reference path="../dom/thread-dom.ts" />
/// <reference path="../../types/domain.d.ts" />

/**
 * Fake MessageAdapter with controllable id/role/text.
 */
class FakeMessageAdapter implements MessageAdapter {
    constructor(public element: HTMLElement, public key: string, public role: string, private text: string) { }

    getText(): string {
        return this.text;
    }

    shouldShowCollapse(): boolean {
        return true;
    }

    storageKey(threadKey: string): string {
        return `${threadKey}:${this.key}`;
    }
}

/**
 * Fake adapter for edge cases: missing ids, uneven pairs, nested messages.
 */
class FakeThreadAdapter implements ThreadAdapter {
    private messages: FakeMessageAdapter[] = [];
    private pairs: DomPairAdapter[] = [];
    private container: HTMLElement;

    constructor(payloads: Array<{ id?: string | null; role?: string; text?: string }>) {
        this.container = document.createElement('main');
        payloads.forEach((payload, idx) => {
            const el = document.createElement('article');
            if (payload.id) el.setAttribute('data-message-id', payload.id);
            el.setAttribute('data-message-author-role', payload.role || 'assistant');
            el.textContent = payload.text || '';
            this.container.appendChild(el);
            const adapter = new FakeMessageAdapter(el, payload.id || `fake-${idx}`, payload.role || 'assistant', payload.text || '');
            this.messages.push(adapter);
        });
        this.pairs = ThreadDom.buildDomPairAdaptersFromMessages(this.messages);
    }

    getTranscriptRoot(): HTMLElement | null {
        return this.container;
    }

    getMessages(): MessageAdapter[] {
        return this.messages;
    }

    getPairs(): PairAdapter[] {
        return this.pairs;
    }

    getPromptMessages(): MessageAdapter[] {
        return this.pairs.map(p => p.query).filter(Boolean) as MessageAdapter[];
    }

    getNavigationMessages(): MessageAdapter[] {
        const prompts = this.getPromptMessages();
        return prompts.length ? prompts : this.messages;
    }

    getPairAt(_root: HTMLElement, index: number): PairAdapter | null {
        return this.pairs[index] || null;
    }

    observe(_root: HTMLElement, _callback: MutationCallback): void { /* no-op */ }
    disconnect(): void { /* no-op */ }
} // FakeThreadAdapter

(globalThis as any).FakeThreadAdapter = FakeThreadAdapter;
(globalThis as any).FakeMessageAdapter = FakeMessageAdapter;
