/// <reference path="../utils.ts" />
/// <reference path="../dom/thread-dom.ts" />
/// <reference path="../dom/message-adapters.ts" />
/// <reference path="../../types/domain.d.ts" />
/// <reference path="../../types/globals.d.ts" />
/// <reference path="./render-scheduler.ts" />
/// <reference path="./thread-metadata.ts" />
/// <reference path="./transcript.ts" />
/// <reference path="../state/message-meta.ts" />
/// <reference path="../controllers/toolbar.ts" />
/// <reference path="../controllers/overview-ruler.ts" />
/// <reference path="../controllers/thread-metadata.ts" />
/// <reference path="./config.ts" />
/// <reference path="../state/focus.ts" />

const BOOTSTRAP_TIMING_FLAG_NAME = '__tagalystDebugBootstrap';
const isRenderTimingEnabled = () => (globalThis as any)[BOOTSTRAP_TIMING_FLAG_NAME] === true;
const logRenderTiming = (label: string, startedAt?: number | null, data?: Record<string, unknown>) => {
    if (!isRenderTimingEnabled()) return;
    const base = typeof startedAt === 'number' ? startedAt : performance.now();
    const elapsed = Math.round(performance.now() - base);
    const parts: any[] = ['[tagalyst][bootstrap]', label, `+${elapsed}ms`];
    if (data) parts.push(data);
    console.info(...parts);
};

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
    private generation = 0;
    private currentSearchQuery = '';
    private bootstrapStartedAt: number | null = null;
    private loggedFirstRender = false;
    private retryScheduled = false;

    constructor(
        private readonly scheduler: RenderScheduler,
        private readonly threadDom: ThreadDom,
        private readonly transcriptService: TranscriptService,
        private readonly toolbar: ToolbarController,
        private readonly highlightController: any,
        private readonly overviewRulerController: any,
        private readonly topPanelController: any,
        private readonly focusController: any,
        private readonly focusService: FocusService,
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
        this.generation += 1;
        this.container = ctx.container;
        this.threadId = ctx.threadId;
        this.threadKey = ctx.threadKey;
        this.threadAdapter = ctx.adapter;
        if (this.bootstrapStartedAt === null) {
            this.bootstrapStartedAt = performance.now();
        }
        this.loggedFirstRender = false;
        const token = this.generation;
        this.scheduler.setRenderer(() => this.runRender(token));
    }

    /**
     * Propagates the bootstrap start time for render timing logs.
     */
    setBootstrapStart(startedAt: number) {
        this.bootstrapStartedAt = startedAt;
        this.loggedFirstRender = false;
    }

    /**
     * Clears the current context and any pending work.
     */
    reset() {
        this.generation += 1;
        this.container = null;
        this.threadId = null;
        this.threadKey = null;
        this.threadAdapter = null;
        this.running = false;
        this.queued = false;
        this.bootstrapStartedAt = null;
        this.loggedFirstRender = false;
    }

    /**
     * Queues a render pass via the scheduler.
     */
    requestRender() {
        const token = this.generation;
        this.scheduler.request(() => this.runRender(token));
    }

    /**
     * Executes a render immediately (bypassing RAF).
     */
    async renderNow() {
        try {
            await this.runRender(this.generation);
        } catch (err) {
            this.reportRenderError(err, 'renderNow');
        }
    }

    hasActiveContainer() {
        return !!this.container;
    }

    private async runRender(token: number) {
        if (token !== this.generation) return;
        if (!this.container || !this.threadKey) return;
        if (this.running) {
            this.queued = true;
            return;
        }
        this.running = true;
        try {
            do {
                this.queued = false;
                await this.renderOnce(token);
            } while (this.queued);
        } catch (err) {
            this.reportRenderError(err, 'runRender');
            this.queued = false;
        } finally {
            this.running = false;
        }
    }

    private async renderOnce(token: number) {
        if (token !== this.generation) return;
        if (!this.container || !this.threadKey) return;
        if (!this.loggedFirstRender) {
            logRenderTiming('render:first', this.bootstrapStartedAt, { threadId: this.threadId, threadKey: this.threadKey });
            this.loggedFirstRender = true;
        }
        try {
            const transcript = this.transcriptService.buildTranscript(this.container, this.threadAdapter);
            const messageCount = transcript.messages.length;
            const promptCount = transcript.pairs.length;
            const charCount = transcript.messages.reduce((sum, msg) => sum + (msg.text?.length || 0), 0);
            const searchQuery = this.focusService.getSearchQuery();
            const entries = transcript.messages.map(message => ({
                adapter: message.adapter,
                el: message.adapter.element,
                key: message.adapter.storageKey(this.threadKey!),
                pairIndex: transcript.pairIndexByMessage.get(message.adapter) ?? null,
            }));
            await this.syncThreadMetadata(promptCount, charCount);
            if (!entries.length) return;
            const keys = entries.map(e => e.key);
            const store = await this.storageService.read(keys);
            const tagCounts = new Map<string, number>();
            this.highlightController.resetAll();
            this.messageMetaRegistry.clear();
            const navEnabled = this.configService.isNavToolbarEnabled ? this.configService.isNavToolbarEnabled() : true;
            if (!navEnabled) {
                document.getElementById('ext-page-controls')?.remove();
                document.querySelectorAll('.ext-toolbar-row').forEach(tb => tb.remove());
            }
            for (const { adapter: messageAdapter, el, key, pairIndex } of entries) {
                if (navEnabled) {
                    this.toolbar.injectToolbar(el, this.threadKey!);
                    this.toolbar.updatePairNumber(messageAdapter, typeof pairIndex === 'number' ? pairIndex : null);
                    this.toolbar.updateMessageLength(messageAdapter);
                }
                const value = store[key] || {};
                const meta = { key, value, pairIndex, adapter: messageAdapter };
                this.messageMetaRegistry.update(el, meta);
                const isSearchHit = !!searchQuery && this.focusService.isSearchHit(meta as any, el);
                el.classList.toggle('ext-search-hit', isSearchHit);
                this.applySearchHighlight(el, isSearchHit ? searchQuery : '');
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
            this.currentSearchQuery = searchQuery;
        } catch (err) {
            this.reportRenderError(err, 'renderOnce');
            this.queued = false;
            this.scheduleRetry();
        }
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

    /**
     * Adds/removes inline search highlights within a message element.
     */
    private applySearchHighlight(el: HTMLElement, query: string) {
        // Clear prior marks
        el.querySelectorAll('.ext-search-mark').forEach(mark => {
            const parent = mark.parentNode;
            if (parent) {
                parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
                parent.normalize();
            }
        });
        const normalized = (query || '').trim();
        if (!normalized) return;
        const regex = new RegExp(normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
            acceptNode: (node) => {
                if (!node.parentElement) return NodeFilter.FILTER_REJECT;
                if ((node.parentElement as HTMLElement).closest(`[${EXT_ATTR}]`)) return NodeFilter.FILTER_REJECT;
                if ((node.parentElement as HTMLElement).classList.contains('ext-search-mark')) return NodeFilter.FILTER_REJECT;
                const text = node.nodeValue || '';
                return regex.test(text) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
            }
        });
        const toProcess: Text[] = [];
        let n = walker.nextNode();
        while (n) {
            toProcess.push(n as Text);
            n = walker.nextNode();
        }
        toProcess.forEach(textNode => {
            const frag = document.createDocumentFragment();
            let lastIndex = 0;
            const text = textNode.nodeValue || '';
            text.replace(regex, (match, offset) => {
                if (offset > lastIndex) {
                    frag.appendChild(document.createTextNode(text.slice(lastIndex, offset)));
                }
                const span = document.createElement('span');
                span.className = 'ext-search-mark';
                span.textContent = match;
                frag.appendChild(span);
                lastIndex = offset + match.length;
                return match;
            });
            if (lastIndex < text.length) {
                frag.appendChild(document.createTextNode(text.slice(lastIndex)));
            }
            textNode.parentNode?.replaceChild(frag, textNode);
        });
    }

    /**
     * Reports render-time failures with thread context.
     */
    private reportRenderError(err: any, phase: string) {
        const payload = {
            phase,
            threadId: this.threadId,
            threadKey: this.threadKey,
            message: (err as any)?.message || String(err),
            stack: (err as any)?.stack,
        };
        console.error('[tagalyst][render] error', payload);
    }

    /**
     * Schedules a single retry after a render error to avoid deadlocks.
     */
    private scheduleRetry() {
        if (this.retryScheduled) return;
        this.retryScheduled = true;
        setTimeout(() => {
            this.retryScheduled = false;
            this.requestRender();
        }, 200);
    }
} // ThreadRenderService

(globalThis as any).ThreadRenderService = ThreadRenderService;
/// <reference path="../controllers/toolbar.ts" />
/// <reference path="../controllers/overview-ruler.ts" />
/// <reference path="../state/message-meta.ts" />
/// <reference path="../controllers/thread-metadata.ts" />
/// <reference path="./config.ts" />
