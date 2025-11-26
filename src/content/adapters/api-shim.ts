/// <reference path="../utils.ts" />
/// <reference path="../dom/message-adapters.ts" />
/// <reference path="../dom/thread-dom.ts" />
/// <reference path="../../types/domain.d.ts" />

type ApiMessagePayload = {
    id: string;
    role: string;
    text: string;
};

class ApiMessageAdapter implements MessageAdapter {
    readonly element: HTMLElement;
    readonly key: string;
    readonly role: string;
    private readonly text: string;

    constructor(payload: ApiMessagePayload) {
        this.element = document.createElement('article');
        this.element.setAttribute('data-message-author-role', payload.role);
        this.element.setAttribute('data-message-id', payload.id);
        this.element.textContent = payload.text;
        this.role = payload.role;
        this.key = payload.id || Utils.hashString(payload.text);
        this.text = payload.text;
    }

    getText(): string {
        return Utils.normalizeText(this.text);
    }

    shouldShowCollapse(): boolean {
        return true;
    }

    storageKey(threadKey: string): string {
        return `${threadKey}:${this.key}`;
    }
}

/**
 * ThreadAdapter shim backed by API-provided messages (no DOM selectors).
 */
class ApiThreadAdapter implements ThreadAdapter {
    private readonly container: HTMLElement;
    private readonly messages: ApiMessageAdapter[];
    private readonly pairs: DomPairAdapter[];

    constructor(payloads: ApiMessagePayload[]) {
        this.container = document.createElement('main');
        this.messages = payloads.map(p => new ApiMessageAdapter(p));
        this.messages.forEach(m => this.container.appendChild(m.element));
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

    getPairAt(root: HTMLElement, index: number): PairAdapter | null {
        return this.pairs[index] || null;
    }

    observe(_root: HTMLElement, _callback: MutationCallback): void {
        // no-op for static API payload
    }

    disconnect(): void {
        // no-op
    }
} // ApiThreadAdapter

(globalThis as any).ApiThreadAdapter = ApiThreadAdapter;
