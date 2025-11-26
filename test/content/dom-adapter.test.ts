import fs from 'fs';
import path from 'path';
import { TextDecoder, TextEncoder } from 'util';
import { ChatGptThreadAdapter, ThreadDom } from '../test-exports';

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

describe('ChatGPT DOM adapters on live fixture', () => {
    let adapter: any;
    let threadDom: any;
    let root: HTMLElement;

    beforeEach(() => {
        const dom = loadThreadFixture();
        root = (dom.window.document.querySelector('main') as HTMLElement) || dom.window.document.body;
        adapter = new ChatGptThreadAdapter();
        threadDom = new ThreadDom(() => adapter);
    });

    it('discovers all messages in order with normalized text', () => {
        const messages = adapter.getMessages(root);
        expect(messages).toHaveLength(6);
        expect(messages.map((m: any) => m.role)).toEqual([
            'user', 'assistant', 'user', 'assistant', 'user', 'assistant',
        ]);
        expect(messages[0].key).toBe(USER_IDS[0]);
        expect(messages[1].key).toBe(ASSISTANT_IDS[0]);
        expect(messages[0].getText()).toContain('Describe what Tagalyst is supposed to do');
        expect(messages[1].getText().startsWith('Tagalyst is your Chrome-based system')).toBe(true);
    });

    it('builds pairs and navigation nodes from the real layout', () => {
        const pairs = threadDom.getPairs(root);
        expect(pairs).toHaveLength(3);
        expect(pairs.map((p: any) => [p.queryId, p.responseId])).toEqual([
            [USER_IDS[0], ASSISTANT_IDS[0]],
            [USER_IDS[1], ASSISTANT_IDS[1]],
            [USER_IDS[2], ASSISTANT_IDS[2]],
        ]);

        const prompts: HTMLElement[] = threadDom.getPromptNodes(root);
        expect(prompts.map((n: HTMLElement) => n.getAttribute('data-message-id'))).toEqual(USER_IDS);

        const navigation = threadDom.getNavigationNodes(root);
        expect(navigation.map((n: HTMLElement) => n.getAttribute('data-message-id'))).toEqual(USER_IDS);
    });
});
