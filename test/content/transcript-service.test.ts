import fs from 'fs';
import path from 'path';
import { TextDecoder, TextEncoder } from 'util';
import { ChatGptThreadAdapter, ThreadDom, TranscriptService } from '../test-exports';

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
const USER_IDS = CONFIG.userIds;
const ASSISTANT_IDS = CONFIG.assistantIds;

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

describe('TranscriptService', () => {
    it('normalizes messages and pairs from the fixture', () => {
        const dom = loadThreadFixture();
        const adapter = new ChatGptThreadAdapter();
        const threadDom = new ThreadDom(() => adapter);
        const transcriptService = new TranscriptService(threadDom);
        const container = dom.window.document.querySelector('main') as HTMLElement;
        const snapshot = transcriptService.buildTranscript(container, adapter);
        expect(snapshot.messages.map(m => m.id)).toEqual([
            USER_IDS[0], ASSISTANT_IDS[0],
            USER_IDS[1], ASSISTANT_IDS[1],
            USER_IDS[2], ASSISTANT_IDS[2],
        ]);
        expect(snapshot.pairs).toHaveLength(3);
        expect(snapshot.pairs.map(p => [p.query?.id || null, p.response?.id || null])).toEqual([
            [USER_IDS[0], ASSISTANT_IDS[0]],
            [USER_IDS[1], ASSISTANT_IDS[1]],
            [USER_IDS[2], ASSISTANT_IDS[2]],
        ]);
    });
});
