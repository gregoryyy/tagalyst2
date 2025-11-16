/// <reference path="./types/domain.d.ts" />
/// <reference path="./types/globals.d.ts" />
/// <reference path="./markdown.ts" />
/// <reference path="./content/state/message-meta.ts" />
/// <reference path="./content/state/focus.ts" />
/// <reference path="./content/dom/message-adapters.ts" />
/// <reference path="./content/dom/thread-dom.ts" />
/// <reference path="./content/dom/chatgpt-adapter.ts" />

/**
 * Tagalyst 2: ChatGPT DOM Tools — content script (MV3)
 * - Defensive discovery with MutationObserver
 * - Non-destructive overlays (no reparenting site nodes)
 * - Local persistence via chrome.storage
 */

const storageService = new StorageService();
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
class EditorController {
    private activeTagEditor: ActiveEditor | null = null;
    private activeNoteEditor: ActiveEditor | null = null;

    constructor(private readonly storage: StorageService) { }

    /**
     * Tears down any active editors.
     */
    teardown() {
        this.closeTagEditor();
        this.closeNoteEditor();
    }

    /**
     * Closes the tag editor if open.
     */
    private closeTagEditor() {
        if (this.activeTagEditor) {
            this.activeTagEditor.cleanup();
            this.activeTagEditor = null;
        }
    }

    /**
     * Closes the note editor if open.
     */
    private closeNoteEditor() {
        if (this.activeNoteEditor) {
            this.activeNoteEditor.cleanup();
            this.activeNoteEditor = null;
        }
    }

    /**
     * Opens the floating tag editor for the specified message.
     */
    async openTagEditor(messageEl: HTMLElement, threadKey: string) {
        if (this.activeTagEditor?.message === messageEl) {
            this.closeTagEditor();
            return;
        }
        this.closeTagEditor();

        const adapter = messageMetaRegistry.resolveAdapter(messageEl);
        const cur = await this.storage.readMessage(threadKey, adapter);
        if (Array.isArray(cur.tags)) {
            cur.tags = cur.tags.map(tag => tag.toLowerCase());
        }
        const existing = Array.isArray(cur.tags) ? cur.tags.join(', ') : '';

        const editor = document.createElement('div');
        editor.className = 'ext-tag-editor';
        Utils.markExtNode(editor);
        editor.innerHTML = `
            <div class="ext-tag-editor-input" contenteditable="true" role="textbox" aria-label="Edit tags" data-placeholder="Add tags…"></div>
            <div class="ext-tag-editor-actions">
                <button type="button" class="ext-tag-editor-save">Save</button>
                <button type="button" class="ext-tag-editor-cancel">Cancel</button>
            </div>
        `;

        const input = editor.querySelector<HTMLElement>('.ext-tag-editor-input');
        if (!input) return;
        input.textContent = existing;

        const toolbar = messageEl.querySelector<HTMLElement>('.ext-toolbar');
        const detachFloating = Utils.mountFloatingEditor(editor, (toolbar || messageEl) as HTMLElement);
        messageEl.classList.add('ext-tag-editing');
        input.focus();
        Utils.placeCaretAtEnd(input);

        const cleanup = () => {
            detachFloating();
            editor.remove();
            messageEl.classList.remove('ext-tag-editing');
            if (this.activeTagEditor?.message === messageEl) this.activeTagEditor = null;
        };

        const save = async () => {
            const raw = input.innerText.replace(/\n+/g, ',');
            const tags = raw.split(',').map(s => s.trim()).filter(Boolean);
            cur.tags = tags.map(tag => tag.toLowerCase());
            await this.storage.writeMessage(threadKey, adapter, cur);
            toolbarController.updateBadges(messageEl, threadKey, cur, adapter);
            cleanup();
        };

        const cancel = () => cleanup();

        const saveBtn = editor.querySelector<HTMLButtonElement>('.ext-tag-editor-save');
        const cancelBtn = editor.querySelector<HTMLButtonElement>('.ext-tag-editor-cancel');
        if (saveBtn) saveBtn.onclick = save;
        if (cancelBtn) cancelBtn.onclick = cancel;
        editor.addEventListener('keydown', (evt) => {
            if (evt.key === 'Escape') {
                evt.preventDefault();
                cancel();
            } else if (evt.key === 'Enter' && (evt.metaKey || evt.ctrlKey)) {
                evt.preventDefault();
                save();
            }
        });
        editor.addEventListener('mousedown', evt => evt.stopPropagation());
        const outsideTag = (evt: MouseEvent) => {
            if (!editor.contains(evt.target as Node)) {
                cancel();
                document.removeEventListener('mousedown', outsideTag, true);
            }
        };
        document.addEventListener('mousedown', outsideTag, true);

        this.activeTagEditor = { message: messageEl, cleanup };
    }

    /**
     * Opens the floating note editor for the specified message.
     */
    async openNoteEditor(messageEl: HTMLElement, threadKey: string) {
        if (this.activeNoteEditor?.message === messageEl) {
            this.closeNoteEditor();
            return;
        }
        this.closeNoteEditor();

        const adapter = messageMetaRegistry.resolveAdapter(messageEl);
        const cur = await this.storage.readMessage(threadKey, adapter);
        const existing = typeof cur.note === 'string' ? cur.note : '';

        const editor = document.createElement('div');
        editor.className = 'ext-note-editor';
        Utils.markExtNode(editor);
        editor.innerHTML = `
            <label class="ext-note-label">
                Annotation
                <textarea class="ext-note-input" rows="3" placeholder="Add details…"></textarea>
            </label>
            <div class="ext-note-actions">
                <button type="button" class="ext-note-save">Save</button>
                <button type="button" class="ext-note-cancel">Cancel</button>
            </div>
        `;

        const input = editor.querySelector<HTMLTextAreaElement>('.ext-note-input');
        if (!input) return;
        input.value = existing;

        const toolbar = messageEl.querySelector<HTMLElement>('.ext-toolbar');
        const detachFloating = Utils.mountFloatingEditor(editor, (toolbar || messageEl) as HTMLElement);
        messageEl.classList.add('ext-note-editing');
        input.focus();
        input.select();

        const cleanup = () => {
            detachFloating();
            editor.remove();
            messageEl.classList.remove('ext-note-editing');
            if (this.activeNoteEditor?.message === messageEl) this.activeNoteEditor = null;
        };

        const save = async () => {
            const value = input.value.trim();
            if (value) {
                cur.note = value;
            } else {
                delete cur.note;
            }
            await this.storage.writeMessage(threadKey, adapter, cur);
            toolbarController.updateBadges(messageEl, threadKey, cur, adapter);
            cleanup();
        };

        const cancel = () => cleanup();

        const saveBtn = editor.querySelector<HTMLButtonElement>('.ext-note-save');
        const cancelBtn = editor.querySelector<HTMLButtonElement>('.ext-note-cancel');
        if (saveBtn) saveBtn.onclick = save;
        if (cancelBtn) cancelBtn.onclick = cancel;
        editor.addEventListener('keydown', (evt) => {
            if (evt.key === 'Escape') {
                evt.preventDefault();
                cancel();
            } else if ((evt.metaKey || evt.ctrlKey) && evt.key === 'Enter') {
                evt.preventDefault();
                save();
            }
        });
        editor.addEventListener('mousedown', evt => evt.stopPropagation());
        const outsideNote = (evt: MouseEvent) => {
            if (!editor.contains(evt.target as Node)) {
                cancel();
                document.removeEventListener('mousedown', outsideNote, true);
            }
        };
        document.addEventListener('mousedown', outsideNote, true);

        this.activeNoteEditor = { message: messageEl, cleanup };
    }
} // EditorController

const editorController = new EditorController(storageService);

type HighlightEntry = {
    id: string;
    start: number;
    end: number;
    text: string;
    annotation?: string;
};

type HighlightRange = {
    range: Range;
    rects: DOMRect[];
};

/**
 * Handles CSS highlighter interactions, selection menus, and hover annotations.
 */
class HighlightController {
    private selectionMenu: HTMLElement | null = null;
    private selectionButton: HTMLButtonElement | null = null;
    private annotateButton: HTMLButtonElement | null = null;
    private annotationPreview: HTMLElement | null = null;
    private selectionMessage: HTMLElement | null = null;
    private selectionCheckId: number | null = null;
    private selectionMode: 'add' | 'remove' | null = null;
    private selectionOffsets: { start: number; end: number } | null = null;
    private selectionText: string | null = null;
    private selectionTargetId: string | null = null;
    private selectionTargetEntry: HighlightEntry | null = null;
    private initialized = false;
    private readonly highlightIdsByMessage = new Map<string, Set<string>>();
    private readonly activeHighlightNames = new Set<string>();
    private readonly highlightMeta = new Map<string, { range: Range; annotation: string }>();
    private readonly annotatedHighlightNames = new Set<string>();
    private highlightStyleEl: HTMLStyleElement | null = null;
    private hoverTooltip: HTMLElement | null = null;
    private hoverActiveId: string | null = null;
    private pointerPos: { x: number; y: number } | null = null;
    private hoverLoopId: number | null = null;
    private readonly onMouseMove = (evt: MouseEvent) => this.handleMouseMove(evt);
    private readonly cssHighlightSupported = typeof CSS !== 'undefined' && 'highlights' in CSS && typeof (window as any).Highlight !== 'undefined';

    constructor(private readonly storage: StorageService) { }

    /**
     * Lazily wires document event listeners for highlight selection.
     */
    init() {
        if (this.initialized) return;
        const handler = () => this.scheduleSelectionCheck();
        document.addEventListener('mouseup', handler, true);
        document.addEventListener('keyup', handler, true);
        document.addEventListener('selectionchange', handler);
        document.addEventListener('mousedown', (evt) => this.handleDocumentMouseDown(evt), true);
        document.addEventListener('mousemove', this.onMouseMove, true);
        this.startHoverLoop();
        this.initialized = true;
    }

    /**
     * Clears all highlights and UI artifacts.
     */
    resetAll() {
        if (!this.cssHighlightSupported) return;
        for (const name of this.activeHighlightNames) {
            (CSS as any).highlights.delete(name);
        }
        this.activeHighlightNames.clear();
        this.annotatedHighlightNames.clear();
        this.highlightIdsByMessage.clear();
        this.highlightMeta.clear();
        this.syncHighlightStyle();
        this.hideHoverTooltip();
        overviewRulerController.refreshMarkers();
    }

    /**
     * Applies serialized highlight data to a message element.
     */
    applyHighlights(messageEl: HTMLElement, highlights: any, adapter?: MessageAdapter | null, threadKey?: string) {
        const adapterRef = adapter ?? messageMetaRegistry.resolveAdapter(messageEl);
        if (!threadKey || !this.cssHighlightSupported) return;
        const messageKey = this.getMessageKey(adapterRef, threadKey);
        this.clearMessageHighlights(messageKey);
        const normalized = this.normalizeHighlights(highlights);
        if (!normalized.length) return;
        const ids = new Set<string>();
        for (const entry of normalized) {
            const built = this.buildRange(messageEl, entry.start, entry.end);
            if (!built) continue;
            const highlight = new (window as any).Highlight(built.range);
            const name = this.getHighlightName(entry.id);
            (CSS as any).highlights.set(name, highlight);
            ids.add(entry.id);
            this.activeHighlightNames.add(name);
            this.highlightMeta.set(entry.id, { range: built.range, annotation: entry.annotation || '' });
            if (entry.annotation?.trim()) {
                this.annotatedHighlightNames.add(name);
            } else {
                this.annotatedHighlightNames.delete(name);
            }
        }
        if (ids.size) {
            this.highlightIdsByMessage.set(messageKey, ids);
        }
        this.syncHighlightStyle();
        overviewRulerController.refreshMarkers();
    }

    private clearMessageHighlights(messageKey: string) {
        if (!this.cssHighlightSupported) return;
        const ids = this.highlightIdsByMessage.get(messageKey);
        if (!ids) return;
        for (const id of ids) {
            const name = this.getHighlightName(id);
            (CSS as any).highlights.delete(name);
            this.activeHighlightNames.delete(name);
            this.annotatedHighlightNames.delete(name);
        }
        this.highlightIdsByMessage.delete(messageKey);
        for (const id of ids) {
            this.highlightMeta.delete(id);
        }
        this.syncHighlightStyle();
        overviewRulerController.refreshMarkers();
    }

    /**
     * Builds ruler marker entries based on highlight positions.
     */
    getOverviewMarkers(adapters: MessageAdapter[], threadKey: string): MarkerDatum[] {
        if (!this.cssHighlightSupported || !adapters?.length) return [];
        const markers: MarkerDatum[] = [];
        for (const adapter of adapters) {
            const el = adapter?.element;
            if (!el || !document.contains(el)) continue;
            if (el.classList.contains('ext-collapsed')) continue;
            const key = this.getMessageKey(adapter, threadKey);
            const ids = this.highlightIdsByMessage.get(key);
            if (!ids?.size) continue;
            for (const id of ids) {
                const meta = this.highlightMeta.get(id);
                const range = meta?.range;
                if (!range) continue;
                const rect = range.getBoundingClientRect();
                if (!rect) continue;
                const docCenter = overviewRulerController.measureScrollSpaceCenter(rect);
                if (typeof docCenter !== 'number' || !Number.isFinite(docCenter)) continue;
                markers.push({
                    docCenter,
                    visualCenter: docCenter,
                    kind: 'highlight',
                    label: meta?.annotation ? 'annotated' : null
                });
            }
        }
        return markers;
    }

    private getMessageKey(adapter: MessageAdapter, threadKey: string) {
        return `${threadKey}:${adapter.key}`;
    }

    private getHighlightName(id: string) {
        const clean = id.replace(/[^a-zA-Z0-9_-]/g, '');
        return `tagalyst-${clean || 'hl'}`;
    }

    private syncHighlightStyle() {
        if (!this.cssHighlightSupported) return;
        const names = Array.from(this.activeHighlightNames);
        if (!names.length) {
            if (this.highlightStyleEl) {
                this.highlightStyleEl.remove();
                this.highlightStyleEl = null;
            }
            return;
        }
        const plain = names.filter(name => !this.annotatedHighlightNames.has(name));
        const annotated = names.filter(name => this.annotatedHighlightNames.has(name));
        const segments: string[] = [];
        if (plain.length) {
            segments.push(`${plain.map(name => `::highlight(${name})`).join(', ')} { background: rgba(255, 242, 168, .9); border-radius: 3px; box-shadow: inset 0 0 0 1px rgba(255, 215, 64, .35); }`);
        }
        if (annotated.length) {
            segments.push(`${annotated.map(name => `::highlight(${name})`).join(', ')} { background: rgba(170, 240, 200, .85); border-radius: 3px; box-shadow: inset 0 0 0 1px rgba(60, 170, 120, .45); }`);
        }
        const css = segments.join('\n');
        if (!this.highlightStyleEl) {
            this.highlightStyleEl = document.createElement('style');
            this.highlightStyleEl.id = 'ext-highlight-style';
            Utils.markExtNode(this.highlightStyleEl);
            document.head.appendChild(this.highlightStyleEl);
        }
        this.highlightStyleEl.textContent = css;
    }

    private buildRange(root: HTMLElement, start: number, end: number): HighlightRange | null {
        if (end <= start) return null;
        const startPos = this.locatePosition(root, start);
        const endPos = this.locatePosition(root, end);
        if (!startPos || !endPos) return null;
        try {
            const range = document.createRange();
            range.setStart(startPos.node, startPos.offset);
            range.setEnd(endPos.node, endPos.offset);
            const rects = Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0);
            return { range, rects };
        } catch {
            return null;
        }
    }

    private locatePosition(root: HTMLElement, target: number) {
        if (target < 0) return null;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode: (node) => Utils.closestExtNode(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
        });
        let remaining = target;
        let lastText: Text | null = null;
        while (walker.nextNode()) {
            const node = walker.currentNode as Text;
            lastText = node;
            const len = node.textContent?.length ?? 0;
            if (remaining <= len) {
                return { node, offset: remaining };
            }
            remaining -= len;
        }
        if (remaining === 0 && lastText) {
            const len = lastText.textContent?.length ?? 0;
            return { node: lastText, offset: len };
        }
        return null;
    }

    private normalizeHighlights(raw: any): HighlightEntry[] {
        if (!Array.isArray(raw)) return [];
        return raw
            .map(entry => ({
                id: typeof entry?.id === 'string' ? entry.id : this.makeHighlightId(),
                start: Number(entry?.start) || 0,
                end: Number(entry?.end) || 0,
                text: typeof entry?.text === 'string' ? entry.text : '',
                annotation: typeof entry?.annotation === 'string' ? entry.annotation : '',
            }))
            .filter(entry => entry.end > entry.start)
            .sort((a, b) => a.start - b.start);
    }

    private computeOffsets(root: HTMLElement, range: Range) {
        try {
            const startRange = document.createRange();
            startRange.setStart(root, 0);
            startRange.setEnd(range.startContainer, range.startOffset);
            const endRange = document.createRange();
            endRange.setStart(root, 0);
            endRange.setEnd(range.endContainer, range.endOffset);
            const start = this.getRangeLength(startRange);
            const end = this.getRangeLength(endRange);
            if (end <= start) return null;
            return { start, end };
        } catch (err) {
            console.error('Failed to compute highlight offsets', err);
            return null;
        }
    }

    private getRangeLength(range: Range) {
        const fragment = range.cloneContents();
        this.stripExtensionNodes(fragment);
        return (fragment.textContent || '').length;
    }

    private stripExtensionNodes(node: DocumentFragment | Element) {
        const extNodes = node.querySelectorAll?.(`[${EXT_ATTR}], .ext-toolbar-row`) || [];
        extNodes.forEach(extNode => extNode.remove());
    }

    private makeHighlightId() {
        return `hl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    }

    private async removeHighlight(messageEl: HTMLElement, adapter: MessageAdapter, threadKey: string, id: string) {
        const value = await this.storage.readMessage(threadKey, adapter);
        const highlights = this.normalizeHighlights(value.highlights);
        const next = highlights.filter(entry => entry.id !== id);
        if (next.length) {
            value.highlights = next;
        } else {
            delete value.highlights;
        }
        await this.storage.writeMessage(threadKey, adapter, value);
        this.applyHighlights(messageEl, next, adapter, threadKey);
    }

    private scheduleSelectionCheck() {
        if (this.selectionCheckId) cancelAnimationFrame(this.selectionCheckId);
        this.selectionCheckId = requestAnimationFrame(() => {
            this.selectionCheckId = null;
            this.evaluateSelection();
        });
    }

    private evaluateSelection() {
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount || selection.isCollapsed) {
            this.hideSelectionMenu();
            return;
        }
        const range = selection.getRangeAt(0);
        if (!range || range.collapsed) {
            this.hideSelectionMenu();
            return;
        }
        const startMessage = this.findMessage(range.startContainer);
        const endMessage = this.findMessage(range.endContainer);
        if (!startMessage || startMessage !== endMessage) {
            this.hideSelectionMenu();
            return;
        }
        if (Utils.closestExtNode(range.startContainer) || Utils.closestExtNode(range.endContainer)) {
            this.hideSelectionMenu();
            return;
        }
        const offsets = this.computeOffsets(startMessage, range);
        if (!offsets) {
            this.hideSelectionMenu();
            return;
        }
        const text = range.toString();
        if (!text.trim()) {
            this.hideSelectionMenu();
            return;
        }
        this.selectionMessage = startMessage;
        this.selectionOffsets = offsets;
        this.selectionText = text;
        const meta = messageMetaRegistry.get(startMessage);
        const highlights = this.normalizeHighlights(meta?.value?.highlights);
        const match = highlights.find(entry => !(offsets.end <= entry.start || offsets.start >= entry.end));
        if (match) {
            this.selectionMode = 'remove';
            this.selectionTargetId = match.id;
            this.selectionTargetEntry = match;
        } else {
            this.selectionMode = 'add';
            this.selectionTargetId = null;
            this.selectionTargetEntry = null;
        }
        this.showSelectionMenu(range);
    }

    private findMessage(node: Node | null) {
        if (!node) return null;
        if (node.nodeType === Node.ELEMENT_NODE) {
            return (node as Element).closest<HTMLElement>('[data-message-author-role]');
        }
        return node.parentElement?.closest<HTMLElement>('[data-message-author-role]') || null;
    }

    private showSelectionMenu(range: Range) {
        const menu = this.selectionMenu ?? this.createSelectionMenu();
        if (!menu) return;
        if (this.selectionButton) {
            this.selectionButton.textContent = this.selectionMode === 'remove' ? 'Remove highlight' : 'Highlight';
        }
        if (this.annotateButton) {
            this.annotateButton.disabled = this.selectionMode !== 'remove';
        }
        if (this.annotationPreview) {
            if (this.selectionMode === 'remove' && this.selectionTargetEntry?.annotation) {
                this.annotationPreview.textContent = this.selectionTargetEntry.annotation;
                this.annotationPreview.style.display = '';
            } else {
                this.annotationPreview.textContent = '';
                this.annotationPreview.style.display = 'none';
            }
        }
        menu.style.display = 'flex';
        const rect = range.getBoundingClientRect();
        const { offsetWidth, offsetHeight } = menu;
        const doc = document.documentElement;
        const viewportWidth = doc?.clientWidth || window.innerWidth;
        const viewportHeight = doc?.clientHeight || window.innerHeight;
        const minLeft = window.scrollX + 8;
        const viewportRightLimit = window.scrollX + viewportWidth - offsetWidth - 8;
        const targetLeft = window.scrollX + rect.left + (rect.width - offsetWidth) / 2;
        const left = Math.max(minLeft, Math.min(viewportRightLimit, targetLeft));
        const preferredTop = window.scrollY + rect.bottom + 12;
        const minTop = window.scrollY + 8;
        const maxTop = window.scrollY + viewportHeight - offsetHeight - 8;
        let top = preferredTop;
        if (top > maxTop) {
            const fallback = window.scrollY + rect.top - offsetHeight - 12;
            top = Math.max(Math.min(fallback, maxTop), minTop);
        }
        menu.style.top = `${top}px`;
        menu.style.left = `${left}px`;
    }

    private hideSelectionMenu() {
        if (this.selectionMenu) {
            this.selectionMenu.style.display = 'none';
        }
        this.selectionMessage = null;
        this.selectionMode = null;
        this.selectionOffsets = null;
        this.selectionText = null;
        this.selectionTargetId = null;
        this.selectionTargetEntry = null;
        if (this.annotationPreview) {
            this.annotationPreview.textContent = '';
            this.annotationPreview.style.display = 'none';
        }
        if (this.annotateButton) {
            this.annotateButton.disabled = true;
        }
    }

    private createSelectionMenu() {
        const menu = document.createElement('div');
        menu.className = 'ext-highlight-menu';
        Utils.markExtNode(menu);
        const highlightBtn = document.createElement('button');
        highlightBtn.type = 'button';
        highlightBtn.textContent = 'Highlight';
        highlightBtn.className = 'ext-highlight-menu-btn';
        highlightBtn.onclick = (evt) => this.handleSelectionAction(evt);
        const annotateBtn = document.createElement('button');
        annotateBtn.type = 'button';
        annotateBtn.textContent = 'Annotate';
        annotateBtn.className = 'ext-highlight-menu-btn ext-highlight-annotate';
        annotateBtn.onclick = (evt) => this.handleAnnotateAction(evt);
        annotateBtn.disabled = true;
        const notePreview = document.createElement('div');
        notePreview.className = 'ext-highlight-note';
        notePreview.style.display = 'none';
        menu.appendChild(highlightBtn);
        menu.appendChild(annotateBtn);
        menu.appendChild(notePreview);
        document.body.appendChild(menu);
        this.selectionMenu = menu;
        this.selectionButton = highlightBtn;
        this.annotateButton = annotateBtn;
        this.annotationPreview = notePreview;
        menu.style.display = 'none';
        return menu;
    }

    private handleDocumentMouseDown(evt: MouseEvent) {
        if (this.selectionMenu && evt.target instanceof Node) {
            if (!this.selectionMenu.contains(evt.target)) {
                this.hideSelectionMenu();
            }
        }
    }
    private async handleSelectionAction(evt: MouseEvent) {
        evt.preventDefault();
        evt.stopPropagation();
        const message = this.selectionMessage;
        if (!message) return;
        const threadKey = Utils.getThreadKey();
        const adapter = messageMetaRegistry.resolveAdapter(message);
        if (this.selectionMode === 'remove' && this.selectionTargetId) {
            await this.removeHighlight(message, adapter, threadKey, this.selectionTargetId);
        } else if (this.selectionMode === 'add' && this.selectionOffsets && this.selectionText?.trim()) {
            const value = await this.storage.readMessage(threadKey, adapter);
            const highlights = this.normalizeHighlights(value.highlights);
            highlights.push({
                id: this.makeHighlightId(),
                start: this.selectionOffsets.start,
                end: this.selectionOffsets.end,
                text: this.selectionText,
                annotation: '',
            });
            highlights.sort((a, b) => a.start - b.start);
            value.highlights = highlights;
            await this.storage.writeMessage(threadKey, adapter, value);
            this.applyHighlights(message, highlights, adapter, threadKey);
        }
        const selection = window.getSelection();
        selection?.removeAllRanges();
        this.hideSelectionMenu();
    }

    private async handleAnnotateAction(evt: MouseEvent) {
        evt.preventDefault();
        evt.stopPropagation();
        if (this.selectionMode !== 'remove' || !this.selectionTargetEntry) return;
        const message = this.selectionMessage;
        if (!message) return;
        const adapter = messageMetaRegistry.resolveAdapter(message);
        const threadKey = Utils.getThreadKey();
        const value = await this.storage.readMessage(threadKey, adapter);
        const highlights = this.normalizeHighlights(value.highlights);
        const target = highlights.find(entry => entry.id === this.selectionTargetEntry?.id);
        if (!target) return;
        const next = window.prompt('Annotation for this highlight:', target.annotation || '');
        if (next === null) return;
        const trimmed = next.trim();
        if (trimmed) {
            target.annotation = trimmed;
        } else {
            delete target.annotation;
        }
        value.highlights = highlights;
        await this.storage.writeMessage(threadKey, adapter, value);
        this.applyHighlights(message, highlights, adapter, threadKey);
        this.selectionTargetEntry = target;
        if (this.annotationPreview) {
            if (trimmed) {
                this.annotationPreview.textContent = trimmed;
                this.annotationPreview.style.display = '';
            } else {
                this.annotationPreview.textContent = '';
                this.annotationPreview.style.display = 'none';
            }
        }
    }


    private handleMouseMove(evt: MouseEvent) {
        this.pointerPos = { x: evt.clientX, y: evt.clientY };
        this.evaluateHover();
    }

    private showHoverTooltip(text: string, pointer: { x: number; y: number }, id: string) {
        const tooltip = this.ensureHoverTooltip();
        tooltip.textContent = text || 'Hello World';
        tooltip.style.display = 'block';
        tooltip.style.opacity = '0';
        const { offsetWidth, offsetHeight } = tooltip;
        const doc = document.documentElement;
        const viewportWidth = doc?.clientWidth || window.innerWidth;
        const viewportHeight = doc?.clientHeight || window.innerHeight;
        const margin = 14;
        let top = window.scrollY + pointer.y + margin;
        if (top + offsetHeight + margin > window.scrollY + viewportHeight) {
            top = window.scrollY + pointer.y - offsetHeight - margin;
        }
        let left = window.scrollX + pointer.x - offsetWidth / 2;
        const minLeft = window.scrollX + 8;
        const maxLeft = window.scrollX + viewportWidth - offsetWidth - 8;
        left = Math.max(minLeft, Math.min(maxLeft, left));
        tooltip.style.top = `${top}px`;
        tooltip.style.left = `${left}px`;
        tooltip.style.opacity = '1';
        this.hoverActiveId = id;
    }

    private hideHoverTooltip() {
        if (this.hoverTooltip) {
            this.hoverTooltip.style.display = 'none';
        }
        this.hoverActiveId = null;
    }

    private ensureHoverTooltip() {
        if (!this.hoverTooltip) {
            const el = document.createElement('div');
            el.className = 'ext-highlight-tooltip';
            Utils.markExtNode(el);
            document.body.appendChild(el);
            this.hoverTooltip = el;
        }
        return this.hoverTooltip;
    }

    private startHoverLoop() {
        const step = () => {
            this.evaluateHover();
            this.hoverLoopId = requestAnimationFrame(step);
        };
        this.hoverLoopId = requestAnimationFrame(step);
    }

    private evaluateHover() {
        if (!this.pointerPos || !this.highlightMeta.size) {
            this.hideHoverTooltip();
            return;
        }
        const { x, y } = this.pointerPos;
        let match: { text: string; rect: DOMRect; id: string } | null = null;
        for (const [id, meta] of this.highlightMeta) {
            if (!meta.annotation) continue;
            const rects = meta.range.getClientRects();
            for (const rect of Array.from(rects)) {
                if (rect.width <= 0 || rect.height <= 0) continue;
                if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
                    match = { text: meta.annotation || 'Hello World', rect, id };
                    break;
                }
            }
            if (match) break;
        }
        if (match && this.pointerPos) {
            this.showHoverTooltip(match.text, this.pointerPos, match.id);
        } else {
            this.hideHoverTooltip();
        }
    }
}

const highlightController = new HighlightController(storageService);
highlightController.init();

/**
 * Composes toolbar rows for each message and manages the global control panel.
 */
class ToolbarController {
    constructor(private readonly focus: FocusService, private readonly storage: StorageService) { }

    /**
     * Creates the page-level navigation/collapse/export controls.
     */
    ensurePageControls(container: HTMLElement, threadKey: string) {
        const existing = document.getElementById('ext-page-controls');
        if (existing) existing.remove();
        const box = document.createElement('div');
        box.id = 'ext-page-controls';
        Utils.markExtNode(box);
        box.innerHTML = `
        <div class="ext-nav-frame">
            <span class="ext-nav-label">Navigate</span>
            <div class="ext-nav-buttons">
                <button id="ext-jump-first" title="Jump to first prompt">⤒</button>
                <button id="ext-jump-last" title="Jump to last prompt">⤓</button>
            </div>
            <div class="ext-nav-buttons">
                <button id="ext-jump-star-prev" title="Previous starred message">★↑</button>
                <button id="ext-jump-star-next" title="Next starred message">★↓</button>
            </div>
        </div>
        <div class="ext-batch-frame">
            <span class="ext-nav-label">Collapse</span>
            <div class="ext-batch-buttons">
                <button id="ext-collapse-all" title="Collapse all prompts">All</button>
                <button id="ext-collapse-unstarred" title="Collapse unstarred prompts">☆</button>
            </div>
        </div>
        <div class="ext-batch-frame">
            <span class="ext-nav-label">Expand</span>
            <div class="ext-batch-buttons">
                <button id="ext-expand-all" title="Expand all prompts">All</button>
                <button id="ext-expand-starred" title="Expand starred prompts">★</button>
            </div>
        </div>
        <div class="ext-export-frame">
            <span class="ext-nav-label">MD Copy</span>
            <div class="ext-export-buttons">
                <button id="ext-export-all" class="ext-export-button">All</button>
                <button id="ext-export-starred" class="ext-export-button">★</button>
            </div>
        </div>
      `;
        document.documentElement.appendChild(box);
        topPanelController.syncWidth();

        const jumpFirstBtn = box.querySelector<HTMLButtonElement>('#ext-jump-first');
        const jumpLastBtn = box.querySelector<HTMLButtonElement>('#ext-jump-last');
        const jumpStarPrevBtn = box.querySelector<HTMLButtonElement>('#ext-jump-star-prev');
        const jumpStarNextBtn = box.querySelector<HTMLButtonElement>('#ext-jump-star-next');
        const collapseAllBtn = box.querySelector<HTMLButtonElement>('#ext-collapse-all');
        const collapseUnstarredBtn = box.querySelector<HTMLButtonElement>('#ext-collapse-unstarred');
        const expandAllBtn = box.querySelector<HTMLButtonElement>('#ext-expand-all');
        const expandStarredBtn = box.querySelector<HTMLButtonElement>('#ext-expand-starred');
        const exportAllBtn = box.querySelector<HTMLButtonElement>('#ext-export-all');
        const exportStarredBtn = box.querySelector<HTMLButtonElement>('#ext-export-starred');

        if (jumpFirstBtn) jumpFirstBtn.onclick = () => this.scrollToNode(container, 0, 'start');
        if (jumpLastBtn) {
            jumpLastBtn.onclick = () => {
                const nodes = threadDom.getNavigationNodes(container);
                if (!nodes.length) return;
                this.scrollToNode(container, nodes.length - 1, 'end', nodes);
            };
        }
        if (jumpStarPrevBtn) jumpStarPrevBtn.onclick = () => { this.scrollFocus(-1); };
        if (jumpStarNextBtn) jumpStarNextBtn.onclick = () => { this.scrollFocus(1); };
        if (collapseAllBtn) collapseAllBtn.onclick = () => threadActions.toggleAll(container, true);
        if (collapseUnstarredBtn) collapseUnstarredBtn.onclick = () => threadActions.collapseByFocus(container, 'out', true);
        if (expandAllBtn) expandAllBtn.onclick = () => threadActions.toggleAll(container, false);
        if (expandStarredBtn) expandStarredBtn.onclick = () => threadActions.collapseByFocus(container, 'in', false);

        if (exportAllBtn) exportAllBtn.onclick = () => exportController.copyThread(container, false);
        if (exportStarredBtn) exportStarredBtn.onclick = () => exportController.copyThread(container, true);

        const controlsState: PageControls = {
            root: box,
            focusPrev: jumpStarPrevBtn,
            focusNext: jumpStarNextBtn,
            collapseNonFocus: collapseUnstarredBtn,
            expandFocus: expandStarredBtn,
            exportFocus: exportStarredBtn,
        };
        focusController.setPageControls(controlsState);
    }

    private scrollToNode(container: HTMLElement, idx: number, block: ScrollLogicalPosition = 'start', list?: HTMLElement[]) {
        const nodes = list || threadDom.getNavigationNodes(container);
        if (!nodes.length) return;
        const clamped = Math.max(0, Math.min(idx, nodes.length - 1));
        const target = nodes[clamped];
        if (target) target.scrollIntoView({ behavior: 'smooth', block, inline: 'nearest' });
    }

    private scrollFocus(delta: number) {
        const adapters = focusController.getMatches();
        if (adapters.length) {
            const idx = this.focus.adjustNav(delta, adapters.length);
            if (idx < 0 || idx >= adapters.length) return;
            const target = adapters[idx];
            if (target) {
                this.scrollElementToToolbar(target.element, 'smooth');
            }
            return;
        }
        if (this.focus.getMode() !== FOCUS_MODES.STARS) return;
        this.scrollAdjacentMessage(delta);
    }

    private scrollAdjacentMessage(delta: number) {
        const container = threadDom.findTranscriptRoot();
        if (!container) return;
        const nodes = threadDom.getNavigationNodes(container);
        if (!nodes.length) return;
        const currentIdx = this.findClosestMessageIndex(nodes);
        const step = delta >= 0 ? 1 : -1;
        const targetIdx = Math.max(0, Math.min(nodes.length - 1, currentIdx + step));
        const target = nodes[targetIdx];
        if (target) {
            this.scrollElementToToolbar(target, 'smooth');
        }
    }

    private findClosestMessageIndex(nodes: HTMLElement[]): number {
        const viewportCenter = window.scrollY + window.innerHeight / 2;
        let closestIdx = 0;
        let smallestDistance = Number.POSITIVE_INFINITY;
        nodes.forEach((node, idx) => {
            const rect = node.getBoundingClientRect();
            const nodeCenter = window.scrollY + rect.top + rect.height / 2;
            const dist = Math.abs(nodeCenter - viewportCenter);
            if (dist < smallestDistance) {
                smallestDistance = dist;
                closestIdx = idx;
            }
        });
        return closestIdx;
    }

    private scrollElementToToolbar(target: HTMLElement | null, behavior: ScrollBehavior = 'smooth') {
        if (!target || !document.contains(target)) return;
        const toolbar = target.querySelector<HTMLElement>('.ext-toolbar-row') || target.querySelector<HTMLElement>('.ext-toolbar');
        const anchor = toolbar || target;
        anchor.scrollIntoView({ behavior, block: toolbar ? 'start' : 'center' });
    }

    /**
     * Injects (or refreshes) a per-message toolbar with actions and badges.
     */
    injectToolbar(el: HTMLElement, threadKey: string) {
        let toolbar = el.querySelector<HTMLElement>('.ext-toolbar');
        if (toolbar) {
            if (toolbar.dataset.threadKey !== threadKey) {
                toolbar.closest('.ext-toolbar-row')?.remove();
                toolbar = null;
            } else {
                threadActions.updateCollapseVisibility(el);
                return;
            }
        }

        const row = document.createElement('div');
        row.className = 'ext-toolbar-row';
        Utils.markExtNode(row);
        const wrap = document.createElement('div');
        wrap.className = 'ext-toolbar';
        Utils.markExtNode(wrap);
        wrap.innerHTML = `
        <span class="ext-badges"></span>
        <button class="ext-tag" title="Edit tags" aria-label="Edit tags"><span class="ext-btn-icon">✎<small>T</small></span></button>
        <button class="ext-note" title="Add annotation" aria-label="Add annotation"><span class="ext-btn-icon">✎<small>A</small></span></button>
        <button class="ext-focus-button" title="Bookmark" aria-pressed="false">☆</button>
        <button class="ext-collapse" title="Collapse message" aria-expanded="true" aria-label="Collapse message">−</button>
      `;
        row.appendChild(wrap);

        const collapseBtn = wrap.querySelector<HTMLButtonElement>('.ext-collapse');
        const focusBtn = wrap.querySelector<HTMLButtonElement>('.ext-focus-button');
        const tagBtn = wrap.querySelector<HTMLButtonElement>('.ext-tag');
        const noteBtn = wrap.querySelector<HTMLButtonElement>('.ext-note');

        if (collapseBtn) {
            collapseBtn.onclick = () => threadActions.collapse(el, !el.classList.contains('ext-collapsed'));
        }
        if (focusBtn) {
            focusBtn.onclick = async () => {
                if (this.focus.getMode() !== FOCUS_MODES.STARS) return;
                const adapter = messageMetaRegistry.resolveAdapter(el);
                const cur = await this.storage.readMessage(threadKey, adapter);
                cur.starred = !cur.starred;
                await this.storage.writeMessage(threadKey, adapter, cur);
                this.updateBadges(el, threadKey, cur, adapter);
                focusController.updateControlsUI();
                overviewRulerController.refreshMarkers();
            };
        }
        if (tagBtn) tagBtn.onclick = () => editorController.openTagEditor(el, threadKey);
        if (noteBtn) noteBtn.onclick = () => editorController.openNoteEditor(el, threadKey);

        wrap.dataset.threadKey = threadKey;
        el.prepend(row);
        const adapter = messageMetaRegistry.resolveAdapter(el);
        if (adapter) {
            this.updateMessageLength(adapter);
        }
        this.ensureUserToolbarButton(el);
        threadActions.updateCollapseVisibility(el);
        threadActions.syncCollapseButton(el);
    }

    /**
     * Shows the pair index badge on user messages.
     */
    updatePairNumber(adapter: MessageAdapter, pairIndex: number | null) {
        const el = adapter.element;
        this.ensureUserToolbarButton(el);
        if (adapter.role !== 'user') {
            const wrap = el.querySelector<HTMLElement>('.ext-pair-number-wrap');
            if (wrap) wrap.remove();
            return;
        }
        if (typeof pairIndex !== 'number') return;
        const row = el.querySelector<HTMLElement>('.ext-toolbar-row');
        if (!row) return;
        let wrap = row.querySelector<HTMLElement>('.ext-pair-number-wrap');
        if (!wrap) {
            wrap = document.createElement('div');
            wrap.className = 'ext-pair-number-wrap';
            row.insertBefore(wrap, row.firstChild);
        }
        let badge = wrap.querySelector<HTMLElement>('.ext-pair-number');
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'ext-pair-number';
            wrap.appendChild(badge);
        }
        badge.textContent = `${pairIndex + 1}.`;
    }

    /**
     * Updates the character count badge for a message.
     */
    updateMessageLength(adapter: MessageAdapter) {
        const el = adapter.element;
        const row = el.querySelector<HTMLElement>('.ext-toolbar-row');
        if (!row) return;
        const toolbar = row.querySelector<HTMLElement>('.ext-toolbar');
        if (!toolbar) return;
        const length = adapter.getText().length;
        if (!length) {
            const existing = row.querySelector<HTMLElement>('.ext-message-length');
            if (existing) existing.remove();
            return;
        }
        let badge = row.querySelector<HTMLElement>('.ext-message-length');
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'ext-message-length';
            row.insertBefore(badge, toolbar);
        } else if (badge.nextElementSibling !== toolbar) {
            row.insertBefore(badge, toolbar);
        }
        badge.textContent = this.formatLength(length);
        badge.setAttribute('aria-label', `${length.toLocaleString()} characters`);
        badge.title = `${length.toLocaleString()} characters`;
    }

    private formatLength(length: number) {
        if (length >= 1000) {
            const value = length >= 10000 ? Math.round(length / 1000) : Math.round(length / 100) / 10;
            return `${value}k chars`;
        }
        return `${length} chars`;
    }

    /**
     * Renders tag/star/note badges and keeps focus/highlight state synced.
     */
    updateBadges(el: HTMLElement, threadKey: string, value: MessageValue, adapter?: MessageAdapter | null) {
        const adapterRef = adapter ?? messageMetaRegistry.resolveAdapter(el);
        const k = `${threadKey}:${adapterRef.key}`;
        const cur = value || {};
        const meta = messageMetaRegistry.update(el, { key: k, value: cur, adapter: adapterRef });
        const badges = el.querySelector<HTMLElement>('.ext-badges');
        if (!badges) return;

        const starred = !!cur.starred;
        el.classList.toggle('ext-starred', starred);

        badges.innerHTML = '';
        const tags = Array.isArray(cur.tags) ? cur.tags : [];
        for (const t of tags) {
            const span = document.createElement('span');
            span.className = 'ext-badge';
            span.textContent = t;
            badges.appendChild(span);
        }

        const note = typeof cur.note === 'string' ? cur.note.trim() : '';
        if (note) {
            const noteChip = document.createElement('span');
            noteChip.className = 'ext-note-pill';
            noteChip.textContent = note.length > 80 ? `${note.slice(0, 77)}…` : note;
            noteChip.title = note;
            badges.appendChild(noteChip);
        }
        highlightController.applyHighlights(el, cur.highlights, adapterRef, threadKey);
        focusController.updateMessageButton(el, meta);
    }

    private handleUserToolbarButtonClick(messageEl: HTMLElement) {
        const messageKey = messageMetaRegistry.resolveAdapter(messageEl).key;
        console.info('[Tagalyst] User toolbar button clicked', { messageKey });
    }

    private ensureUserToolbarButton(_el: HTMLElement): HTMLButtonElement | null {
        // Placeholder for future per-user actions. Intentionally disabled to avoid extra UI clutter.
        return null;
    }
} // ToolbarController


/**
 * Provides DOM mutations for collapsing/expanding message rows.
 */
class ThreadActions {
    /**
     * Ensures collapse buttons stay visible when a toolbar is injected.
     */
    updateCollapseVisibility(el: HTMLElement) {
        const btn = this.getCollapseButton(el);
        if (!btn) return;
        btn.style.display = '';
    }

    /**
     * Updates collapse button state/labels to match message classes.
     */
    syncCollapseButton(el: HTMLElement) {
        const btn = this.getCollapseButton(el);
        if (!btn) return;
        const collapsed = el.classList.contains('ext-collapsed');
        btn.textContent = collapsed ? '+' : '−';
        btn.setAttribute('title', collapsed ? 'Expand message' : 'Collapse message');
        btn.setAttribute('aria-label', collapsed ? 'Expand message' : 'Collapse message');
        btn.setAttribute('aria-expanded', String(!collapsed));
    }
    
    /**
     * Toggles the collapsed state for one message block.
     */
    collapse(el: HTMLElement, yes: boolean) {
        const collapsed = !!yes;
        el.classList.toggle('ext-collapsed', collapsed);
        this.syncCollapseButton(el);
        this.toggleMessageAttachments(el, collapsed);
        if (configService.isOverviewEnabled()) {
            overviewRulerController.refreshMarkers();
        }
    }
    
    /**
     * Applies collapse/expand state to every discovered message.
     */
    toggleAll(container: HTMLElement, yes: boolean) {
        const msgs = threadDom.enumerateMessages(container);
        for (const m of msgs) this.collapse(m, !!yes);
    }
    
    /**
     * Applies collapse state against the current focus subset.
     */
    collapseByFocus(container: HTMLElement, target: 'in' | 'out', collapseState: boolean) {
        const matches = focusController.getMatches();
        if (!matches.length) return;
        const matchSet = new Set(matches.map(adapter => adapter.element));
        for (const el of threadDom.enumerateMessages(container)) {
            const isMatch = matchSet.has(el);
            if (target === 'in' ? isMatch : !isMatch) {
                this.collapse(el, collapseState);
            }
        }
    }

    private getCollapseButton(el: HTMLElement) {
        return el.querySelector<HTMLButtonElement>('.ext-toolbar .ext-collapse');
    }

    private toggleMessageAttachments(el: HTMLElement, collapsed: boolean) {
        const parent = el.parentElement;
        if (!parent) return;
        const toggleNode = (node: Element | null) => {
            if (!node) return;
            if (this.isAttachmentNode(node)) {
                node.classList.toggle('ext-hidden-attachment', collapsed);
            }
        };
        let next = el.nextElementSibling;
        while (next && !next.getAttribute('data-message-author-role')) {
            toggleNode(next);
            next = next.nextElementSibling;
        }
        let prev = el.previousElementSibling;
        while (prev && !prev.getAttribute('data-message-author-role')) {
            toggleNode(prev);
            prev = prev.previousElementSibling;
        }
    }

    private isAttachmentNode(node: Element) {
        if (node.querySelector('canvas')) return true;
        const id = node.id || '';
        if (id.startsWith('textdoc-message') || id === 'codemirror') return true;
        if (node.classList?.contains('textdoc-message')) return true;
        if (node.querySelector('.cm-editor')) return true;
        return false;
    }
} // ThreadActions

const threadActions = new ThreadActions();

/**
 * Handles assembling Markdown exports for focused or full threads.
 */
class ExportController {
    /**
     * Copies Markdown for either the whole thread or focused messages only.
     */
    copyThread(container: HTMLElement, focusOnly: boolean) {
        try {
            const md = this.buildMarkdown(container, focusOnly);
            this.writeToClipboard(md);
        } catch (err) {
            console.error('Export failed', err);
        }
    }

    buildMarkdown(container: HTMLElement, focusOnly: boolean): string {
        const pairs = threadDom.getPairs(container);
        const sections: string[] = [];
        pairs.forEach((pair, idx) => {
            const num = idx + 1;
            const isFocused = focusOnly ? focusController.isPairFocused(pair) : true;
            if (focusOnly && !isFocused) return;
            const query = this.extractMarkdown(pair.query);
            const response = this.extractMarkdown(pair.response);
            const lines: string[] = [];
            if (query) {
                lines.push(`### ${num}. Prompt`, '', query);
            }
            if (response) {
                if (lines.length) lines.push('');
                lines.push(`### ${num}. Response`, '', response);
            }
            if (lines.length) sections.push(lines.join('\n'));
        });
        return sections.join('\n\n');
    }

    private extractMarkdown(el: HTMLElement | null) {
        if (!el) return '';
        const clone = el.cloneNode(true) as HTMLElement;
        this.stripExtensionNodes(clone);
        const content = clone.querySelector<HTMLElement>('.markdown') || clone;
        return new MarkdownSerializer().toMarkdown(content).trim();
    }

    private stripExtensionNodes(root: HTMLElement) {
        root.querySelectorAll(`[${EXT_ATTR}]`).forEach(node => node.remove());
        root.querySelectorAll('.ext-toolbar-row').forEach(node => node.remove());
        root.querySelectorAll('button').forEach(node => node.remove());
        root.querySelectorAll('svg').forEach(node => node.remove());
    }

    private writeToClipboard(md: string) {
        if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
            const plain = new Blob([md], { type: 'text/plain' });
            const markdown = new Blob([md], { type: 'text/markdown' });
            const item = new ClipboardItem({
                'text/plain': plain,
                'text/markdown': markdown,
            });
            navigator.clipboard.write([item]).catch(err => {
                console.error('Export failed', err);
                navigator.clipboard.writeText(md).catch(fallbackErr => console.error('Fallback export failed', fallbackErr));
            });
            return;
        }
        navigator.clipboard.writeText(md).catch(err => console.error('Export failed', err));
    }
} // ExportController

const exportController = new ExportController();

// ---------------------- Orchestration --------------------------
/**
 * Entry point: finds the thread, injects UI, and watches for updates.
 */
/**
 * Coordinates thread discovery, toolbar injection, and mutation observation.
 */
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

        const threadKey = Utils.getThreadKey();
        this.toolbar.ensurePageControls(container, threadKey);
        topPanelController.ensurePanels();
        topPanelController.updateConfigUI();
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
                    const entries = messageAdapters.map(messageAdapter => ({
                        adapter: messageAdapter,
                        el: messageAdapter.element,
                        key: messageAdapter.storageKey(threadKey),
                        pairIndex: pairMap.get(messageAdapter) ?? null,
                    }));
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
        const controls = document.getElementById('ext-page-controls');
        if (controls) controls.remove();
        const panel = topPanelController.getElement();
        if (panel) panel.remove();
        topPanelController.reset();
        overviewRulerController.reset();
        focusController.reset();
        this.threadAdapter?.disconnect();
        activeThreadAdapter = null;
    }
} // BootstrapOrchestrator

const threadDom = new ThreadDom(() => activeThreadAdapter);
const toolbarController = new ToolbarController(focusService, storageService);
const bootstrapOrchestrator = new BootstrapOrchestrator(toolbarController, storageService);

async function bootstrap(): Promise<void> {
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
