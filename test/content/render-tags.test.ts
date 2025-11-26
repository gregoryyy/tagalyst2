import { ThreadRenderService, TranscriptService, ThreadDom, FakeThreadAdapter } from '../test-exports';

const noop = () => { /* noop */ };

describe('ThreadRenderService tag/metadata flow', () => {
    const makeService = (adapter: any, container: HTMLElement) => {
        const renderScheduler = new (global as any).RenderScheduler();
        const toolbar = {
            injectToolbar: jest.fn(),
            updatePairNumber: jest.fn(),
            updateMessageLength: jest.fn(),
            updateBadges: jest.fn(),
        };
        const highlightController = { resetAll: jest.fn() };
        const overviewRulerController = { setExpandable: jest.fn(), update: jest.fn(), reset: jest.fn() };
        const topPanelController = { updateTagList: jest.fn(), updateSearchResultCount: jest.fn() };
        const focusController = { refreshButtons: jest.fn() };
        const configService = {
            doesOverviewExpand: () => true,
            isOverviewEnabled: () => false,
            isMetaToolbarEnabled: () => false,
            isSearchEnabled: () => true,
        };
        const storageService = {
            read: async () => ({
                'thread:a': { tags: ['x', 'y'] },
                'thread:b': { tags: ['y'] },
                'thread:c': {},
            }),
        };
        const messageMetaRegistry = { clear: jest.fn(), update: jest.fn() };
        const threadMetadataService = { updateLength: jest.fn(), updateChars: jest.fn(), read: jest.fn(async () => ({})) };
        const threadMetadataController = { render: jest.fn(), ensure: noop };
        const transcriptService = new TranscriptService(new ThreadDom(() => adapter));
        const focusService = new (global as any).FocusService(configService);
        const service = new ThreadRenderService(
            renderScheduler,
            new ThreadDom(() => adapter),
            transcriptService,
            toolbar as any,
            highlightController as any,
            overviewRulerController as any,
            topPanelController as any,
            focusController as any,
            focusService as any,
            configService as any,
            storageService as any,
            messageMetaRegistry as any,
            threadMetadataService as any,
            threadMetadataController as any,
        );
        service.attach({ container, threadId: 'thread', threadKey: 'thread', adapter });
        return { service, topPanelController };
    };

    it('computes tag counts from storage metadata', async () => {
        const adapter = new FakeThreadAdapter([
            { id: 'a', role: 'user', text: 'Q1' },
            { id: 'b', role: 'assistant', text: 'A1' },
            { id: 'c', role: 'user', text: 'Q2' },
        ]);
        const container = adapter.getTranscriptRoot() as HTMLElement;
        const { service, topPanelController } = makeService(adapter, container);
        await service.renderNow();
        expect(topPanelController.updateTagList).toHaveBeenCalledWith([
            { tag: 'y', count: 2 },
            { tag: 'x', count: 1 },
        ]);
    });

    it('applies stored highlights and note metadata to messages', async () => {
        const adapter = new FakeThreadAdapter([
            { id: 'a', role: 'user', text: 'Q1' },
            { id: 'b', role: 'assistant', text: 'A1' },
        ]);
        const container = adapter.getTranscriptRoot() as HTMLElement;
        const renderScheduler = new (global as any).RenderScheduler();
        const toolbar = {
            injectToolbar: jest.fn((el: HTMLElement) => {
                let badges = el.querySelector('.ext-badges');
                if (!badges) {
                    badges = document.createElement('span');
                    badges.className = 'ext-badges';
                    el.prepend(badges);
                }
            }),
            updatePairNumber: jest.fn(),
            updateMessageLength: jest.fn(),
            updateBadges: jest.fn((el: HTMLElement, threadKey: string, value: any, adapterArg: any) => {
                if (value?.starred) el.classList.add('ext-starred');
                highlightController.applyHighlights(el, value.highlights, adapterArg, threadKey);
            }),
        };
        const highlightController = { resetAll: jest.fn(), applyHighlights: jest.fn() };
        const overviewRulerController = { setExpandable: jest.fn(), update: jest.fn(), reset: jest.fn() };
        const topPanelController = { updateTagList: jest.fn(), updateSearchResultCount: jest.fn() };
        const focusController = { refreshButtons: jest.fn() };
        const configService = {
            doesOverviewExpand: () => true,
            isOverviewEnabled: () => false,
            isMetaToolbarEnabled: () => false,
            isSearchEnabled: () => true,
        };
        const storageService = {
            read: async () => ({
                'thread:a': { highlights: [{ start: 0, end: 2 }], note: 'note', starred: true },
                'thread:b': {},
            }),
        };
        const messageMetaRegistry = { clear: jest.fn(), update: jest.fn() };
        const threadMetadataService = { updateLength: jest.fn(), updateChars: jest.fn(), read: jest.fn(async () => ({})) };
        const threadMetadataController = { render: jest.fn(), ensure: noop };
        const transcriptService = new TranscriptService(new ThreadDom(() => adapter));
        const focusService = new (global as any).FocusService(configService);
        const service = new ThreadRenderService(
            renderScheduler,
            new ThreadDom(() => adapter),
            transcriptService,
            toolbar as any,
            highlightController as any,
            overviewRulerController as any,
            topPanelController as any,
            focusController as any,
            focusService as any,
            configService as any,
            storageService as any,
            messageMetaRegistry as any,
            threadMetadataService as any,
            threadMetadataController as any,
        );
        service.attach({ container, threadId: 'thread', threadKey: 'thread', adapter });
        await service.renderNow();
        const msg = container.querySelector('[data-message-id="a"]') as HTMLElement;
        expect(highlightController.applyHighlights).toHaveBeenCalledWith(msg, [{ start: 0, end: 2 }], expect.anything(), 'thread');
        expect(msg.classList.contains('ext-starred')).toBe(true);
    });
});
