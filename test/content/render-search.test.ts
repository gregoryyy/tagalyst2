import { ThreadRenderService, TranscriptService, ThreadDom, FakeThreadAdapter, FocusService } from '../test-exports';

const noop = () => { /* noop */ };

describe('ThreadRenderService search highlights', () => {
    it('marks search-hit messages with CSS class', async () => {
        const renderScheduler = new (global as any).RenderScheduler();
        const configService: any = {
            isSearchEnabled: () => true,
            areTagsEnabled: () => true,
            doesOverviewExpand: () => true,
            isOverviewEnabled: () => false,
            isMetaToolbarEnabled: () => false,
        };
        const focusService = new FocusService(configService);
        focusService.setSearchQuery('Q1');
        const focusController = {
            refreshButtons: jest.fn(),
        };
        const toolbar = {
            injectToolbar: jest.fn(),
            updatePairNumber: jest.fn(),
            updateMessageLength: jest.fn(),
            updateBadges: jest.fn(),
        };
        const highlightController = { resetAll: jest.fn() };
        const overviewRulerController = { setExpandable: jest.fn(), update: jest.fn(), reset: jest.fn() };
        const topPanelController = { updateTagList: jest.fn(), updateSearchResultCount: jest.fn() };
        const storageService = { read: async () => ({}) };
        const messageMetaRegistry = { clear: jest.fn(), update: jest.fn(), getStore: () => new Map(), resolveAdapter: () => null };
        const threadMetadataService = { updateLength: jest.fn(), updateChars: jest.fn(), read: jest.fn(async () => ({})) };
        const threadMetadataController = { render: jest.fn(), ensure: noop };
        const adapter = new FakeThreadAdapter([
            { id: 'a', role: 'user', text: 'Q1 text' },
            { id: 'b', role: 'assistant', text: 'A1' },
        ]);
        const container = adapter.getTranscriptRoot() as HTMLElement;
        const transcriptService = new TranscriptService(new ThreadDom(() => adapter));
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
        const hits = Array.from(container.querySelectorAll('.ext-search-hit'));
        expect(hits.length).toBe(1);
        expect(hits[0].getAttribute('data-message-id')).toBe('a');
    });
});
