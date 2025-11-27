import fs from 'fs';
import path from 'path';
import {
    RenderScheduler,
    ThreadRenderService,
    TranscriptService,
    ThreadDom,
    FakeThreadAdapter,
    FocusService,
} from '../test-exports';

const noop = () => { /* noop */ };

describe('ThreadRenderService baseline (200 messages)', () => {
    it('renders a long thread and logs a baseline summary', async () => {
        const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined as any);
        const fixturePath = path.join(__dirname, '../fixtures/render-baseline.json');
        const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as { count: number; textLength: number };
        const payloads = Array.from({ length: fixture.count }).map((_, idx) => ({
            id: `m${idx}`,
            role: idx % 2 === 0 ? 'user' : 'assistant',
            text: `Message ${idx} ${'x'.repeat(fixture.textLength)}`,
        }));
        const adapter = new FakeThreadAdapter(payloads);
        const container = adapter.getTranscriptRoot() as HTMLElement;
        const renderScheduler = new RenderScheduler();
        const configService: any = {
            isSearchEnabled: () => false,
            areTagsEnabled: () => false,
            doesSearchExpand: () => false,
            doTagsExpand: () => false,
            doesOverviewExpand: () => true,
            isOverviewEnabled: () => true,
            isMetaToolbarEnabled: () => false,
            isNavToolbarEnabled: () => true,
            isSidebarLabelsEnabled: () => false,
            isPerfDebugEnabled: () => false,
        };
        const focusService = new FocusService(configService);
        const focusController = { refreshButtons: jest.fn() };
        const toolbar = {
            injectToolbar: jest.fn(),
            updatePairNumber: jest.fn(),
            updateMessageLength: jest.fn(),
            updateBadges: jest.fn(),
        };
        const highlightController = { resetAll: jest.fn() };
        const overviewRulerController = { setExpandable: jest.fn(), ensure: jest.fn(), update: jest.fn(), reset: jest.fn() };
        const topPanelController = { updateTagList: jest.fn(), updateSearchResultCount: jest.fn() };
        const storageService = { read: jest.fn(async () => ({})) };
        const messageMetaRegistry = { clear: jest.fn(), update: jest.fn(), getStore: () => new Map(), resolveAdapter: () => null };
        const threadMetadataService = { updateLength: jest.fn(), updateChars: jest.fn(), read: jest.fn(async () => ({})) };
        const threadMetadataController = { render: jest.fn(), ensure: noop };
        const threadDom = new ThreadDom(() => adapter);
        const transcriptService = new TranscriptService(threadDom);

        const service = new ThreadRenderService(
            renderScheduler,
            threadDom,
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

        service.attach({ container, threadId: 'thread-200', threadKey: 'thread-200', adapter });

        const firstStart = performance.now();
        await service.renderNow();
        const firstDuration = performance.now() - firstStart;

        const steadyStart = performance.now();
        await service.renderNow();
        const steadyDuration = performance.now() - steadyStart;

        const summary = {
            messages: payloads.length,
            prompts: payloads.length / 2,
            firstRenderMs: Math.round(firstDuration),
            steadyRenderMs: Math.round(steadyDuration),
            toolbarInjected: toolbar.injectToolbar.mock.calls.length,
            overviewEnsured: overviewRulerController.ensure.mock.calls.length,
            overviewUpdated: overviewRulerController.update.mock.calls.length,
        };

        // Log once for baseline collection.
        console.info('[tagalyst][perf-baseline]', summary);

        expect(summary.messages).toBe(200);
        expect(toolbar.injectToolbar).toHaveBeenCalled();
        expect(overviewRulerController.update).toHaveBeenCalled();
        expect(infoSpy).toHaveBeenCalledWith('[tagalyst][perf-baseline]', expect.objectContaining({
            messages: 200,
            prompts: expect.any(Number),
            firstRenderMs: expect.any(Number),
            steadyRenderMs: expect.any(Number),
        }));
        infoSpy.mockRestore();
    });
});
