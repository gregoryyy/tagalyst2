/// <reference path="../utils.ts" />
/// <reference path="../dom/thread-dom.ts" />
/// <reference path="../dom/message-adapters.ts" />
/// <reference path="../../types/domain.d.ts" />
/// <reference path="../../types/globals.d.ts" />
/// <reference path="./render-scheduler.ts" />
/// <reference path="./thread-metadata.ts" />

/**
 * Central render loop for thread UI. Coalesces refreshes through a single scheduler
 * and owns render-time state (counts, metadata sync, toolbar injection).
 */
class ThreadRenderService {
    private container: HTMLElement | null = null;
    private threadId: string | null = null;
    private threadKey: string | null = null;
    private threadAdapter: ThreadAdapter | null = null;
    private running = false;
    private queued = false;

    constructor(
        private readonly scheduler: RenderScheduler,
        private readonly threadDom: ThreadDom,
        private readonly toolbar: ToolbarController,
        private readonly highlightController: any,
        private readonly overviewRulerController: any,
        private readonly topPanelController: any,
        private readonly focusController: any,
        private readonly configService: ConfigService,
        private readonly storageService: StorageService,
        private readonly messageMetaRegistry: MessageMetaRegistry,
        private readonly threadMetadataService: ThreadMetadataService,
        private readonly threadMetadataController: ThreadMetadataController,
    ) { }

    /**
    * Establishes the current render context and primes the scheduler.
    */
    attach(ctx: { container: HTMLElement; threadId: string; threadKey: string; adapter: ThreadAdapter | null }) {
        this.container = ctx.container;
        this.threadId = ctx.threadId;
        this.threadKey = ctx.threadKey;
        this.threadAdapter = ctx.adapter;
        this.scheduler.setRenderer(() => this.runRender());
    }

    /**
     * Clears the current context and any pending work.
     */
    reset() {
        this.container = null;
        this.threadId = null;
        this.threadKey = null;
        this.threadAdapter = null;
        this.running = false;
        this.queued = false;
    }

    /**
     * Queues a render pass via the scheduler.
     */
    requestRender() {
        this.scheduler.request(() => this.runRender());
    }

    /**
     * Executes a render immediately (bypassing RAF).
     */
    async renderNow() {
        await this.runRender();
    }

    private async runRender() {
        if (!this.container || !this.threadKey) return;
        if (this.running) {
            this.queued = true;
            return;
        }
        this.running = true;
        try {
            do {
                this.queued = false;
                await this.renderOnce();
            } while (this.queued);
        } finally {
            this.running = false;
        }
    }

    private async renderOnce() {
        if (!this.container || !this.threadKey) return;
        const messageAdapters = this.resolveMessages(this.container);
        const pairAdapters = this.threadDom.buildPairAdaptersFromMessages(messageAdapters);
        const pairMap = this.buildPairMap(pairAdapters);
        const messageCount = messageAdapters.length;
        const promptCount = pairAdapters.length;
        const charCount = messageAdapters.reduce((sum, adapter) => {
            try {
                return sum + (adapter.getText()?.length || 0);
            } catch {
                return sum;
            }
        }, 0);
        const entries = messageAdapters.map(messageAdapter => ({
            adapter: messageAdapter,
            el: messageAdapter.element,
            key: messageAdapter.storageKey(this.threadKey!),
            pairIndex: pairMap.get(messageAdapter) ?? null,
        }));
        await this.syncThreadMetadata(promptCount, charCount);
        if (!entries.length) return;
        const keys = entries.map(e => e.key);
        const store = await this.storageService.read(keys);
        const tagCounts = new Map<string, number>();
        this.highlightController.resetAll();
        this.messageMetaRegistry.clear();
        for (const { adapter: messageAdapter, el, key, pairIndex } of entries) {
            this.toolbar.injectToolbar(el, this.threadKey!);
            this.toolbar.updatePairNumber(messageAdapter, typeof pairIndex === 'number' ? pairIndex : null);
            this.toolbar.updateMessageLength(messageAdapter);
            const value = store[key] || {};
            this.messageMetaRegistry.update(el, { key, value, pairIndex, adapter: messageAdapter });
            if (value && Array.isArray(value.tags)) {
                for (const t of value.tags) {
                    if (!t) continue;
                    tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
                }
            }
            this.toolbar.updateBadges(el, this.threadKey!, value, messageAdapter);
        }
        const sortedTags = Array.from(tagCounts.entries())
            .map(([tag, count]) => ({ tag, count }))
            .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
        this.topPanelController.updateTagList(sortedTags);
        this.focusController.refreshButtons();
        this.overviewRulerController.setExpandable(this.configService.doesOverviewExpand());
        if (this.configService.isOverviewEnabled() && entries.length) {
            this.overviewRulerController.update(this.container, entries);
        } else {
            this.overviewRulerController.reset();
        }
        this.topPanelController.updateSearchResultCount();
    }

    private resolveMessages(container: HTMLElement): MessageAdapter[] {
        const adapter = this.threadAdapter;
        return (adapter
            ? adapter.getMessages(container)
            : ThreadDom.defaultEnumerateMessages(container).map(el => new DomMessageAdapter(el)));
    }

    private buildPairMap(pairAdapters: PairAdapter[]): Map<MessageAdapter, number> {
        const pairMap = new Map<MessageAdapter, number>();
        pairAdapters.forEach((pair, idx) => {
            pair.getMessages().forEach(msg => pairMap.set(msg, idx));
        });
        return pairMap;
    }

    private async syncThreadMetadata(promptCount: number, charCount: number) {
        if (!this.threadId) return;
        const desiredLength = typeof promptCount === 'number' && promptCount >= 0 ? promptCount : 0;
        const desiredChars = typeof charCount === 'number' && charCount >= 0 ? charCount : 0;
        await this.threadMetadataService.updateLength(this.threadId, desiredLength);
        await this.threadMetadataService.updateChars(this.threadId, desiredChars);
        const meta = await this.threadMetadataService.read(this.threadId);
        this.threadMetadataController.render(this.threadId, meta);
    }
} // ThreadRenderService

(globalThis as any).ThreadRenderService = ThreadRenderService;
