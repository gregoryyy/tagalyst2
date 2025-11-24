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
        const service = new ThreadRenderService(
            renderScheduler,
            new ThreadDom(() => adapter),
            transcriptService,
            toolbar as any,
            highlightController as any,
            overviewRulerController as any,
            topPanelController as any,
            focusController as any,
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
});
