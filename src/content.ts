/// <reference path="./types/domain.d.ts" />
/// <reference path="./types/globals.d.ts" />
/// <reference path="./content/markdown.ts" />
/// <reference path="./content/state/message-meta.ts" />
/// <reference path="./content/state/focus.ts" />
/// <reference path="./content/dom/message-adapters.ts" />
/// <reference path="./content/dom/thread-dom.ts" />
/// <reference path="./content/dom/chatgpt-adapter.ts" />
/// <reference path="./content/controllers/keyboard.ts" />
/// <reference path="./content/services/page-classifier.ts" />
/// <reference path="./content/services/thread-metadata.ts" />
/// <reference path="./content/controllers/thread-metadata.ts" />
/// <reference path="./content/controllers/sidebar-labels.ts" />
/// <reference path="./content/controllers/project-list-labels.ts" />

/**
 * Tagalyst 2: ChatGPT DOM Tools — content script (MV3)
 * - Defensive discovery with MutationObserver
 * - Non-destructive overlays (no reparenting site nodes)
 * - Local persistence via chrome.storage
 */

const storageService = new StorageService();
const pageClassifier = new PageClassifier();
/**
 * Manages extension configuration toggles and notifies listeners on change.
 */
let activeThreadAdapter: ThreadAdapter | null = null;

const messageMetaRegistry = new MessageMetaRegistry();

type ActiveEditor = {
    message: HTMLElement;
    cleanup: () => void;
};

type PageControls = {
    root: HTMLElement;
    focusPrev: HTMLButtonElement | null;
    focusNext: HTMLButtonElement | null;
    collapseNonFocus: HTMLButtonElement | null;
    expandFocus: HTMLButtonElement | null;
    exportFocus: HTMLButtonElement | null;
};

/**
 * Throttles expensive renders through requestAnimationFrame.
 */
const renderScheduler = new RenderScheduler();
const configService = new ConfigService(storageService, renderScheduler);

/**
 * Holds focus mode state derived from tags/search/stars and exposes helpers to evaluate matches.
 */
const focusService = new FocusService(configService);

/**
 * Bridges FocusService state with UI controls/buttons on the page.
 */
const focusController = new FocusController(focusService, messageMetaRegistry);

/**
 * Manages the floating search/tag control panel at the top of the page.
 */
const topPanelController = new TopPanelController(focusService, configService, focusController);
const overviewRulerController = new OverviewRulerController();
focusController.attachSelectionSync(() => {
    topPanelController.syncSelectionUI();
    topPanelController.updateSearchResultCount();
    if (configService.isOverviewEnabled()) {
        overviewRulerController.refreshMarkers();
    }
});
configService.onChange(cfg => {
    enforceFocusConstraints(cfg);
    topPanelController.updateConfigUI();
    overviewRulerController.setExpandable(!!cfg.overviewExpands);
    if (!cfg.overviewEnabled) {
        overviewRulerController.reset();
    } else {
        overviewRulerController.refreshMarkers();
    }
    if (configService.isSidebarLabelsEnabled()) {
        sidebarLabelController.start();
    } else {
        sidebarLabelController.stop();
    }
    const showMeta = configService.isMetaToolbarEnabled ? configService.isMetaToolbarEnabled() : true;
    const container = threadDom.findTranscriptRoot();
    const threadId = deriveThreadId();
    if (showMeta) {
        threadMetadataController.ensure(container, threadId);
        threadMetadataService.read(threadId).then(meta => {
            threadMetadataController.render(threadId, meta);
        });
    } else {
        document.getElementById('ext-thread-meta')?.remove();
    }
});

const enforceFocusConstraints = (cfg: typeof contentDefaultConfig) => {
    let changed = false;
    if (!cfg.searchEnabled) {
        focusService.setSearchQuery('');
        topPanelController.clearSearchInput();
        changed = true;
    }
    if (!cfg.tagsEnabled) {
        focusService.clearTags();
        changed = true;
    }
    if (changed) focusController.syncMode();
};

type MarkerDatum = {
    docCenter: number;
    visualCenter?: number | null;
    label?: string | null;
    kind?: 'message' | 'star' | 'tag' | 'search' | 'highlight';
};

type OverviewEntry = {
    adapter: MessageAdapter;
    pairIndex?: number | null;
};

/**
 * Renders the miniature overview ruler showing message, highlight, and focus markers.
 */
const editorController = new EditorController(storageService);
const threadMetadataService = new ThreadMetadataService(storageService);
const threadMetadataController = new ThreadMetadataController(threadMetadataService, editorController);
const sidebarLabelController = new SidebarLabelController(threadMetadataService, configService);
const projectListLabelController = new ProjectListLabelController(threadMetadataService, configService);


const exportController = new ExportController();

class BootstrapOrchestrator {
    private refreshRunning = false;
    private refreshQueued = false;
    private threadAdapter: ThreadAdapter | null = null;

    constructor(private readonly toolbar: ToolbarController, private readonly storage: StorageService) { }

    /**
     * Bootstraps the UI when a transcript is detected.
     */
    async run() {
        // Wait a moment for the app shell to mount
        await Utils.sleep(600);
        await configService.load();
        this.teardownUI();
        this.threadAdapter = new ChatGptThreadAdapter();
        activeThreadAdapter = this.threadAdapter;
        const container = threadDom.findTranscriptRoot();
        const pageKind = pageClassifier.classify(location.pathname);
        if (pageKind !== 'thread' && pageKind !== 'project-thread') {
            this.teardownUI();
            this.threadAdapter?.disconnect();
            activeThreadAdapter = null;
            return;
        }

        const threadKey = Utils.getThreadKey();
        const threadId = deriveThreadId();
        sidebarLabelController.start();
        const ensureMeta = async () => {
            if (configService.isMetaToolbarEnabled()) {
                threadMetadataController.ensure(container, threadId);
                threadMetadataController.render(threadId, await threadMetadataService.read(threadId));
            } else {
                document.getElementById('ext-thread-meta')?.remove();
            }
        };
        // Initial and delayed retry to handle late header mounts.
        await ensureMeta();
        setTimeout(ensureMeta, 700);
        const header = document.querySelector('#conversation-header-actions') || document.querySelector('main');
        if (header) {
            const metaObserver = new MutationObserver(() => {
                ensureMeta();
            });
            metaObserver.observe(header, { childList: true, subtree: true, characterData: true });
        }
        const showMeta = configService.isMetaToolbarEnabled ? configService.isMetaToolbarEnabled() : true;
        if (showMeta) {
            threadMetadataController.ensure(container, threadId);
            threadMetadataController.render(threadId, await threadMetadataService.read(threadId));
        } else {
            document.getElementById('ext-thread-meta')?.remove();
        }
        this.toolbar.ensurePageControls(container, threadKey);
        topPanelController.ensurePanels();
        topPanelController.updateConfigUI();
        highlightController.init();
        keyboardController.attach(container);
        if (configService.isOverviewEnabled() && this.hasMessages(container)) {
            overviewRulerController.ensure(container);
            overviewRulerController.setExpandable(configService.doesOverviewExpand());
        } else {
            overviewRulerController.reset();
        }

        const render = async () => {
            if (this.refreshRunning) {
                this.refreshQueued = true;
                return;
            }
            this.refreshRunning = true;
            try {
                do {
                    this.refreshQueued = false;
                    const messageAdapters = this.resolveMessages(container);
                    const pairAdapters = threadDom.buildPairAdaptersFromMessages(messageAdapters);
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
                        key: messageAdapter.storageKey(threadKey),
                        pairIndex: pairMap.get(messageAdapter) ?? null,
                    }));
                    await this.syncThreadMetadata(threadId, promptCount, charCount);
                    if (!entries.length) break;
                    const keys = entries.map(e => e.key);
                    const store = await this.storage.read(keys);
                    const tagCounts = new Map<string, number>();
                    highlightController.resetAll();
                    messageMetaRegistry.clear();
                    for (const { adapter: messageAdapter, el, key, pairIndex } of entries) {
                        this.toolbar.injectToolbar(el, threadKey);
                        this.toolbar.updatePairNumber(messageAdapter, typeof pairIndex === 'number' ? pairIndex : null);
                        this.toolbar.updateMessageLength(messageAdapter);
                        const value = store[key] || {};
                        messageMetaRegistry.update(el, { key, value, pairIndex, adapter: messageAdapter });
                        if (value && Array.isArray(value.tags)) {
                            for (const t of value.tags) {
                                if (!t) continue;
                                tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
                            }
                        }
                        this.toolbar.updateBadges(el, threadKey, value, messageAdapter);
                    }
                const sortedTags = Array.from(tagCounts.entries())
                    .map(([tag, count]) => ({ tag, count }))
                    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
                topPanelController.updateTagList(sortedTags);
                focusController.refreshButtons();
                if (configService.isOverviewEnabled() && entries.length) {
                    overviewRulerController.update(container, entries);
                } else {
                    overviewRulerController.reset();
                }
                topPanelController.updateSearchResultCount();
                } while (this.refreshQueued);
            } finally {
                this.refreshRunning = false;
            }
        };

        renderScheduler.setRenderer(render);
        await render();
        this.threadAdapter.observe(container, (records) => {
            if (!records.some(Utils.mutationTouchesExternal)) return;
            renderScheduler.request(render);
        });
    }

    /**
     * Resolves MessageAdapters for the container via thread adapters or defaults.
     */
    private resolveMessages(container: HTMLElement): MessageAdapter[] {
        const threadAdapter = this.threadAdapter;
        return (threadAdapter
            ? threadAdapter.getMessages(container)
            : ThreadDom.defaultEnumerateMessages(container).map(el => new DomMessageAdapter(el)));
    }

    /**
     * Builds a lookup from MessageAdapter to pair index.
     */
    private buildPairMap(pairAdapters: PairAdapter[]): Map<MessageAdapter, number> {
        const pairMap = new Map<MessageAdapter, number>();
        pairAdapters.forEach((pair, idx) => {
            pair.getMessages().forEach(msg => pairMap.set(msg, idx));
        });
        return pairMap;
    }

    /**
     * Updates thread-level metadata (length) and re-renders the header UI.
     */
    private async syncThreadMetadata(threadId: string, promptCount: number, charCount: number) {
        if (!threadId) return;
        const desiredLength = typeof promptCount === 'number' && promptCount >= 0 ? promptCount : 0;
        const desiredChars = typeof charCount === 'number' && charCount >= 0 ? charCount : 0;
        await threadMetadataService.updateLength(threadId, desiredLength);
        await threadMetadataService.updateChars(threadId, desiredChars);
        const meta = await threadMetadataService.read(threadId);
        threadMetadataController.render(threadId, meta);
    }

    /**
     * Returns true when the container currently contains messages.
     */
    private hasMessages(container: HTMLElement) {
        return threadDom.enumerateMessages(container).length > 0;
    }

    /**
     * Removes all injected UI and listeners.
     */
    private teardownUI() {
        editorController.teardown();
        document.querySelectorAll('.ext-tag-editor').forEach(editor => editor.remove());
        document.querySelectorAll('.ext-note-editor').forEach(editor => editor.remove());
        document.querySelectorAll('.ext-toolbar-row').forEach(tb => tb.remove());
        document.querySelectorAll('.ext-tag-editing').forEach(el => el.classList.remove('ext-tag-editing'));
        document.querySelectorAll('.ext-note-editing').forEach(el => el.classList.remove('ext-note-editing'));
        document.getElementById('ext-thread-meta')?.remove();
        const controls = document.getElementById('ext-page-controls');
        if (controls) controls.remove();
        const panel = topPanelController.getElement();
        if (panel) panel.remove();
        topPanelController.reset();
        keyboardController.detach();
        overviewRulerController.reset();
        focusController.reset();
        this.threadAdapter?.disconnect();
        activeThreadAdapter = null;
    }
} // BootstrapOrchestrator

const threadDom = new ThreadDom(() => activeThreadAdapter);
const highlightController = new HighlightController(storageService, overviewRulerController);
const threadActions = new ThreadActions(threadDom, messageMetaRegistry);

const toolbarController = new ToolbarController({
    focusService,
    focusController,
    storageService,
    editorController,
    threadDom,
    threadActions,
    highlightController,
    overviewRulerController,
});
const keyboardController = new KeyboardController({
    threadDom,
    focusService,
    focusController,
    threadActions,
    exportController,
    storageService,
    messageMetaRegistry,
    topPanelController,
});
const bootstrapOrchestrator = new BootstrapOrchestrator(toolbarController, storageService);

async function bootstrap(): Promise<void> {
    const pageKind = pageClassifier.classify(location.pathname);
    sidebarLabelController.start();
    if (pageKind === 'project') {
        projectListLabelController.start();
        bootstrapOrchestrator['teardownUI']?.();
        return;
    }
    if (pageKind !== 'thread' && pageKind !== 'project-thread') {
        bootstrapOrchestrator['teardownUI']?.();
        return;
    }
    projectListLabelController.stop();
    await bootstrapOrchestrator.run();
}

// Some pages use SPA routing; re-bootstrap on URL changes
let lastHref = location.href;
new MutationObserver(() => {
    if (location.href !== lastHref) {
        lastHref = location.href;
       bootstrap();
    }
}).observe(document, { subtree: true, childList: true });

// Also poll URL changes in case SPA navigation doesn't trigger mutations
setInterval(() => {
    if (location.href !== lastHref) {
        lastHref = location.href;
        bootstrap();
    }
}, 800);

// Surface a minimal pairing API for scripts / devtools.
window.__tagalyst = Object.assign(window.__tagalyst || {}, {
    getThreadPairs: (): TagalystPair[] => {
        const root = threadDom.findTranscriptRoot();
        return threadDom.getPairs(root);
    },
    getThreadPair: (idx: number): TagalystPair | null => {
        const root = threadDom.findTranscriptRoot();
        return threadDom.getPair(root, idx);
    },
}) as TagalystApi;

// First boot
bootstrap();

if (chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;
        const change = changes[CONTENT_CONFIG_STORAGE_KEY];
        if (!change) return;
        configService.apply(change.newValue);
    });
}
