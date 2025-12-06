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
/// <reference path="./content/services/thread-renderer.ts" />
/// <reference path="./content/services/transcript.ts" />
/// <reference path="./content/adapters/registry.ts" />
/// <reference path="./content/services/dom-watcher.ts" />

/**
 * Tagalyst 2: ChatGPT DOM Tools — content script (MV3)
 * - Defensive discovery with MutationObserver
 * - Non-destructive overlays (no reparenting site nodes)
 * - Local persistence via chrome.storage
 */
const BOOTSTRAP_DEBUG_FLAG = '__tagalystDebugBootstrap';
const isBootstrapTimingEnabled = () => (globalThis as any)[BOOTSTRAP_DEBUG_FLAG] === true;
const logBootstrapTiming = (label: string, startedAt: number, data?: Record<string, unknown>) => {
    if (!isBootstrapTimingEnabled()) return;
    const elapsed = Math.round(performance.now() - startedAt);
    const parts: any[] = ['[tagalyst][bootstrap]', label, `+${elapsed}ms`];
    if (data) parts.push(data);
    console.info(...parts);
};
const BOOTSTRAP_NOTICE_ID = 'ext-bootstrap-error';
const showBootstrapError = (message: string) => {
    try {
        document.getElementById(BOOTSTRAP_NOTICE_ID)?.remove();
        const box = document.createElement('div');
        box.id = BOOTSTRAP_NOTICE_ID;
        box.setAttribute('role', 'alert');
        box.textContent = message;
        box.style.position = 'fixed';
        box.style.top = '10px';
        box.style.right = '10px';
        box.style.zIndex = '2147483647';
        box.style.background = 'rgba(187, 0, 0, 0.9)';
        box.style.color = '#fff';
        box.style.padding = '8px 12px';
        box.style.borderRadius = '6px';
        box.style.fontSize = '12px';
        box.style.fontFamily = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        box.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.25)';
        box.style.pointerEvents = 'auto';
        document.body?.appendChild(box);
    } catch (err) {
        console.error('Tagalyst bootstrap error', err);
    }
};

const storageService = new StorageService();
const pageClassifier = new PageClassifier();
/**
 * Manages extension configuration toggles and notifies listeners on change.
 */
let activeThreadAdapter: ThreadAdapter | null = null;
const adapterRegistry = new ThreadAdapterRegistry();
adapterRegistry.register({
    name: 'chatgpt-dom',
    supports: (loc: Location) => /chatgpt\.com|chat\.openai\.com/i.test(loc.host || ''),
    create: () => new ChatGptThreadAdapter(),
});

const messageMetaRegistry = new MessageMetaRegistry();

type ActiveEditor = {
    message: HTMLElement;
    cleanup: () => void;
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

let threadRenderServiceRef: ThreadRenderService | null = null;
const requestRender = () => { threadRenderServiceRef?.requestRender(); };
/**
 * Manages the floating search/tag control panel at the top of the page.
 */
const topPanelController = new TopPanelController(focusService, configService, focusController, requestRender);
const overviewRulerController = new OverviewRulerController();
focusController.attachSelectionSync(() => {
    topPanelController.syncSelectionUI();
    topPanelController.updateSearchResultCount();
    requestRender();
});
configService.onChange(cfg => {
    enforceFocusConstraints(cfg);
    const container = threadDom.findTranscriptRoot();
    const hasContainer = !!container;
    const threadKey = Utils.getThreadKey();
    const threadId = deriveThreadId();
    if (cfg.searchEnabled || cfg.tagsEnabled) {
        topPanelController.ensurePanels();
    } else {
        topPanelController.getElement()?.remove();
        topPanelController.reset();
    }
    topPanelController.updateConfigUI();
    overviewRulerController.setExpandable(!!cfg.overviewExpands);
    if (cfg.overviewEnabled && hasContainer && threadDom.enumerateMessages(container!).length) {
        overviewRulerController.ensure(container!);
    } else {
        overviewRulerController.reset();
    }
    if (configService.isSidebarLabelsEnabled()) {
        sidebarLabelController.start();
    } else {
        sidebarLabelController.stop();
    }
    const messageToolbarOn = configService.isMessageToolbarEnabled ? configService.isMessageToolbarEnabled() : true;
    if (!messageToolbarOn && container) {
        document.querySelectorAll('.ext-toolbar-row').forEach(tb => tb.remove());
    }
    if (cfg.navToolbarEnabled === false && container) {
        document.getElementById('ext-page-controls')?.remove();
    } else if (container) {
        toolbarController.ensurePageControls(container, threadKey);
    }
    requestRender();
    const showMeta = configService.isMetaToolbarEnabled ? configService.isMetaToolbarEnabled() : true;
    if (showMeta && container) {
        threadMetadataController.ensure(container, threadId);
        threadMetadataService.read(threadId).then(meta => {
            threadMetadataController.render(threadId, meta);
        });
    } else {
        document.getElementById('ext-thread-meta')?.remove();
    }
    requestRender();
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
    private threadAdapter: ThreadAdapter | null = null;

    constructor(
        private readonly toolbar: ToolbarController,
        private readonly storage: StorageService,
        private readonly renderService: ThreadRenderService,
    ) { }

    /**
     * Bootstraps the UI when a transcript is detected.
     */
    async run() {
        const startedAt = performance.now();
        const initialPath = location.pathname;
        logBootstrapTiming('run:start', startedAt, { path: location.pathname });
        // Wait a moment for the app shell to mount
        await Utils.sleep(600);
        if (location.pathname !== initialPath) {
            logBootstrapTiming('run:nav-abort', startedAt, { from: initialPath, to: location.pathname });
            return;
        }
        logBootstrapTiming('config:load:start', startedAt);
        try {
            const cfg = await configService.load();
            logBootstrapTiming('config:load:done', startedAt, { navToolbar: cfg?.navToolbarEnabled, overview: cfg?.overviewEnabled });
        } catch (err) {
            logBootstrapTiming('config:load:failed', startedAt, { error: (err as any)?.message || String(err) });
            console.error('Tagalyst failed to load config', err);
            showBootstrapError('Tagalyst failed to load settings. Reload the page or re-enable the extension.');
            return;
        }
        if (location.pathname !== initialPath) {
            logBootstrapTiming('run:nav-abort', startedAt, { from: initialPath, to: location.pathname });
            return;
        }
        this.teardownUI();
        this.threadAdapter = adapterRegistry.getAdapterForLocation(location);
        logBootstrapTiming('adapter:selected', startedAt, {
            adapter: (this.threadAdapter as any)?.name || (this.threadAdapter as any)?.constructor?.name || 'none',
        });
        activeThreadAdapter = this.threadAdapter;
        const container = await this.findTranscriptRootWithRetry();
        logBootstrapTiming('transcript:root', startedAt, { found: !!container });
        const pageKind = pageClassifier.classify(location.pathname);
        if (pageKind !== 'thread' && pageKind !== 'project-thread') {
            this.teardownUI();
            this.threadAdapter?.disconnect();
            activeThreadAdapter = null;
            return;
        }
        if (!container) {
            logBootstrapTiming('transcript:root:missing', startedAt);
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

        if (configService.isNavToolbarEnabled()) {
            this.toolbar.ensurePageControls(container, threadKey);
        } else {
            document.getElementById('ext-page-controls')?.remove();
            document.querySelectorAll('.ext-toolbar-row').forEach(tb => tb.remove());
        }

        this.renderService.setBootstrapStart(startedAt);
        logBootstrapTiming('render:attach', startedAt, { threadId, threadKey });
        this.renderService.attach({ container, threadId, threadKey, adapter: this.threadAdapter });
        await this.renderService.renderNow();
        this.threadAdapter.observe(container, (records) => {
            if (!records.some(Utils.mutationTouchesExternal)) return;
            this.renderService.requestRender();
        });
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
        this.renderService.reset();
        activeThreadAdapter = null;
        domWatcher.watchContainer(null);
    }

    /**
     * Attempts to find the transcript root with a short retry to handle late mounts.
     */
    private async findTranscriptRootWithRetry(): Promise<HTMLElement | null> {
        const first = threadDom.findTranscriptRoot();
        if (first) return first;
        await Utils.sleep(250);
        return threadDom.findTranscriptRoot();
    }
} // BootstrapOrchestrator

const threadDom = new ThreadDom(() => activeThreadAdapter);
const highlightController = new HighlightController(storageService, overviewRulerController, requestRender);
const threadActions = new ThreadActions(threadDom, messageMetaRegistry, requestRender);
const transcriptService = new TranscriptService(threadDom);

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
    requestRender,
});
const threadRenderService = new ThreadRenderService(
    renderScheduler,
    threadDom,
    transcriptService,
    toolbarController,
    highlightController,
    overviewRulerController,
    topPanelController,
    focusController,
    focusService,
    configService,
    storageService,
    messageMetaRegistry,
    threadMetadataService,
    threadMetadataController,
);
threadRenderServiceRef = threadRenderService;
const domWatcher = new DomWatcher({
    onMutations: () => {
        if (!threadRenderService.hasActiveContainer()) return;
        requestRender();
    },
    onNav: () => handleSpaNavigation(),
    onRootChange: (prev, next) => {
        if (prev && prev !== next) {
            threadRenderService.reset();
            sidebarLabelController.stop();
            projectListLabelController.stop();
        }
        if (next) {
            sidebarLabelController.start();
            projectListLabelController.start();
        }
    },
});
const bootstrapOrchestrator = new BootstrapOrchestrator(toolbarController, storageService, threadRenderService);

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

async function handleSpaNavigation(): Promise<void> {
    const pageKind = pageClassifier.classify(location.pathname);
    const isThreadPage = pageKind === 'thread' || pageKind === 'project-thread';
    if (isThreadPage && activeThreadAdapter) {
        const container = threadDom.findTranscriptRoot();
        if (!container) {
            await bootstrap();
            return;
        }
        const threadKey = Utils.getThreadKey();
        const threadId = deriveThreadId();
        sidebarLabelController.start();
        const showMeta = configService.isMetaToolbarEnabled ? configService.isMetaToolbarEnabled() : true;
        if (showMeta) {
            threadMetadataController.ensure(container, threadId);
            threadMetadataService.read(threadId).then(meta => {
                threadMetadataController.render(threadId, meta);
            });
        } else {
            document.getElementById('ext-thread-meta')?.remove();
        }
        if (configService.isNavToolbarEnabled()) {
            toolbarController.ensurePageControls(container, threadKey);
        } else {
            document.getElementById('ext-page-controls')?.remove();
            document.querySelectorAll('.ext-toolbar-row').forEach(tb => tb.remove());
        }
        topPanelController.ensurePanels();
        threadRenderService.attach({ container, threadId, threadKey, adapter: activeThreadAdapter });
        domWatcher.watchContainer(container);
        await threadRenderService.renderNow();
        return;
    }
    await bootstrap();
}

// Some pages use SPA routing; re-bootstrap on URL changes
domWatcher.watchUrl();

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
handleSpaNavigation();

if (chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;
        const change = changes[CONTENT_CONFIG_STORAGE_KEY];
        if (!change) return;
        configService.apply(change.newValue);
    });
}
