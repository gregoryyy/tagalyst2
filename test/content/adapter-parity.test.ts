import fs from 'fs';
import path from 'path';
import { TextDecoder, TextEncoder } from 'util';
import { ChatGptThreadAdapter, ThreadDom, TranscriptService, ApiThreadAdapter } from '../test-exports';

if (!(global as any).TextEncoder) (global as any).TextEncoder = TextEncoder;
if (!(global as any).TextDecoder) (global as any).TextDecoder = TextDecoder;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { JSDOM } = require('jsdom') as typeof import('jsdom');

type DomAdapterConfig = {
    fixture: string;
    url: string;
    userIds: string[];
    assistantIds: string[];
};

function loadConfig(): DomAdapterConfig {
    const raw = fs.readFileSync(path.resolve(__dirname, './dom-adapter.conf.json'), 'utf8');
    return JSON.parse(raw) as DomAdapterConfig;
}

const CONFIG = loadConfig();
const THREAD_FIXTURE = path.resolve(__dirname, CONFIG.fixture);
const THREAD_URL = CONFIG.url;

function loadThreadFixture() {
    const html = fs.readFileSync(THREAD_FIXTURE, 'utf8');
    const dom = new JSDOM(html, { url: THREAD_URL, pretendToBeVisual: true });
    const { window } = dom;
    (global as any).window = window;
    (global as any).document = window.document;
    (global as any).HTMLElement = window.HTMLElement;
    (global as any).Node = window.Node;
    (global as any).MutationObserver = window.MutationObserver;
    (global as any).getComputedStyle = window.getComputedStyle.bind(window);
    return dom;
}

describe('Adapter parity (DOM vs API shim)', () => {
    it('produces equivalent transcripts', () => {
        const dom = loadThreadFixture();
        const chatgptAdapter = new ChatGptThreadAdapter();
        const threadDom = new ThreadDom(() => chatgptAdapter);
        const transcriptService = new TranscriptService(threadDom);
        const container = dom.window.document.querySelector('main') as HTMLElement;
        const domTranscript = transcriptService.buildTranscript(container, chatgptAdapter);

        const payloads = domTranscript.messages.map(msg => ({
            id: msg.id || '',
            role: msg.role,
            text: msg.text,
        }));
        const apiAdapter = new ApiThreadAdapter(payloads);
        const apiTranscript = transcriptService.buildTranscript(apiAdapter.getTranscriptRoot() as HTMLElement, apiAdapter);

        expect(apiTranscript.messages.map(m => m.id)).toEqual(domTranscript.messages.map(m => m.id));
        expect(apiTranscript.messages.map(m => m.text)).toEqual(domTranscript.messages.map(m => m.text));
        expect(apiTranscript.pairs.map(p => [p.query?.id || null, p.response?.id || null]))
            .toEqual(domTranscript.pairs.map(p => [p.query?.id || null, p.response?.id || null]));
    });
});
