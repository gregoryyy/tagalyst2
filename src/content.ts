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
    topPanelController.updateConfigUI();
    overviewRulerController.setExpandable(!!cfg.overviewExpands);
    if (!cfg.overviewEnabled) {
        overviewRulerController.reset();
    }
    if (configService.isSidebarLabelsEnabled()) {
        sidebarLabelController.start();
    } else {
        sidebarLabelController.stop();
    }
    requestRender();
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
    }
} // BootstrapOrchestrator

const threadDom = new ThreadDom(() => activeThreadAdapter);
const highlightController = new HighlightController(storageService, overviewRulerController, requestRender);
const threadActions = new ThreadActions(threadDom, messageMetaRegistry, requestRender);

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
    toolbarController,
    highlightController,
    overviewRulerController,
    topPanelController,
    focusController,
    configService,
    storageService,
    messageMetaRegistry,
    threadMetadataService,
    threadMetadataController,
);
threadRenderServiceRef = threadRenderService;
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
        toolbarController.ensurePageControls(container, threadKey);
        topPanelController.ensurePanels();
        threadRenderService.attach({ container, threadId, threadKey, adapter: activeThreadAdapter });
        await threadRenderService.renderNow();
        return;
    }
    await bootstrap();
}

// Some pages use SPA routing; re-bootstrap on URL changes
let lastHref = location.href;
new MutationObserver(() => {
    if (location.href !== lastHref) {
        lastHref = location.href;
       handleSpaNavigation();
    }
}).observe(document, { subtree: true, childList: true });

// Also poll URL changes in case SPA navigation doesn't trigger mutations
setInterval(() => {
    if (location.href !== lastHref) {
        lastHref = location.href;
        handleSpaNavigation();
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
handleSpaNavigation();

if (chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;
        const change = changes[CONTENT_CONFIG_STORAGE_KEY];
        if (!change) return;
        configService.apply(change.newValue);
    });
}
