import { FakeThreadAdapter, TranscriptService, ThreadDom, ChatGptThreadAdapter } from '../test-exports';
import fs from 'fs';
import path from 'path';
import { TextDecoder, TextEncoder } from 'util';

if (!(global as any).TextEncoder) (global as any).TextEncoder = TextEncoder;
if (!(global as any).TextDecoder) (global as any).TextDecoder = TextDecoder;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { JSDOM } = require('jsdom') as typeof import('jsdom');

const THREAD_FIXTURE = path.resolve(__dirname, '../../test-data/Thread3.html');
const THREAD_URL = 'https://chatgpt.com/thread';

function loadFixture() {
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

describe('Adapter harnesses', () => {
    it('handles missing ids and uneven pairs via FakeThreadAdapter', () => {
        const threadDom = new ThreadDom(() => null);
        const transcriptService = new TranscriptService(threadDom);
        const fake = new FakeThreadAdapter([
            { role: 'user', text: 'Q1' },
            { role: 'assistant', text: 'A1' },
            { role: 'user', text: 'Q2' }, // missing response
        ]);
        const snapshot = transcriptService.buildTranscript(fake.getTranscriptRoot() as HTMLElement, fake);
        expect(snapshot.messages.map(m => m.text)).toEqual(['Q1', 'A1', 'Q2']);
        expect(snapshot.pairs).toHaveLength(2);
        expect(snapshot.pairs[1].response).toBeNull();
    });

    it('keeps DOM and ChatGPT adapter pairing stable on fixture', () => {
        const dom = loadFixture();
        const adapter = new ChatGptThreadAdapter();
        const threadDom = new ThreadDom(() => adapter);
        const transcriptService = new TranscriptService(threadDom);
        const container = dom.window.document.querySelector('main') as HTMLElement;
        const snapshot = transcriptService.buildTranscript(container, adapter);
        expect(snapshot.pairs.length).toBeGreaterThan(0);
        snapshot.pairs.forEach(pair => {
            if (pair.response) {
                expect(pair.response.role).toBe('assistant');
            }
        });
    });
});
