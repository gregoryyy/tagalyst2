/**
 * Tagalyst 2: ChatGPT DOM Tools — content script (MV3)
 * - Defensive discovery with MutationObserver
 * - Non-destructive overlays (no reparenting site nodes)
 * - Local persistence via chrome.storage
 */

// -------------------------- Utilities --------------------------
/**
 * Small helper for delaying async flows without blocking the UI thread.
 */
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * Produces a deterministic 32-bit FNV-1a hash for lightweight keys.
 */
function hashString(s: string) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
    }
    return ("0000000" + h.toString(16)).slice(-8);
}

/**
 * Strips excess whitespace and zero-width chars so hashes stay stable.
 */
function normalizeText(t: string) {
    return (t || "")
        .replace(/\s+/g, " ")
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .trim();
}

/**
 * Generates a thread-level key using the conversation ID when available.
 */
function getThreadKey(): string {
    // Prefer URL path (conversation id). Fallback to title + domain.
    try {
        const u = new URL(location.href);
        if (u.pathname && u.pathname.length > 1) return u.pathname.replace(/\W+/g, "-");
    } catch { }
    return hashString(document.title + location.host);
}

/**
 * Returns the DOM-provided message UUID if available.
 */
function getMessageId(el: Element | null) {
    return el?.getAttribute?.('data-message-id') || null;
}

/**
 * Stable-ish per-message key derived from ChatGPT IDs or fallback heuristics.
 */
function keyForMessage(el: HTMLElement) {
    const domId = getMessageId(el);
    if (domId) return domId;
    const text = normalizeText(el.innerText).slice(0, 4000); // perf cap
    const idx = Array.prototype.indexOf.call(el.parentElement?.children || [], el);
    return hashString(text + "|" + idx);
}

/**
 * Determines whether the collapse control should be shown for a message.
 * Hidden for single-line prompts (no line breaks).
 */
function shouldShowCollapseControl(el: HTMLElement) {
    const role = el?.getAttribute?.('data-message-author-role');
    if (role !== 'user') return true;
    const text = (el.innerText || '').trim();
    if (!text) return false;
    const style = getComputedStyle(el);
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) || 18;
    const lines = lineHeight ? el.clientHeight / lineHeight : 0;
    if (lines > 1.4) return true;
    return text.length > 160 || text.includes('\n');
}

/**
 * Promise-wrapped chrome.storage.local get.
 */
async function getStore(keys: string[]): Promise<Record<string, any>> {
    if (!Array.isArray(keys) || !keys.length) return {};
    return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

/**
 * Promise-wrapped chrome.storage.local set.
 */
async function setStore(obj: Record<string, any>): Promise<void> {
    return new Promise(resolve => chrome.storage.local.set(obj, () => resolve()));
}

class StorageService {
    async read(keys: string[]): Promise<Record<string, MessageValue>> {
        return getStore(keys);
    }

    async write(record: Record<string, MessageValue>): Promise<void> {
        if (!record || !Object.keys(record).length) return;
        await setStore(record);
    }

    keyForMessage(threadKey: string, adapter: MessageAdapter): string {
        return adapter.storageKey(threadKey);
    }

    async readMessage(threadKey: string, adapter: MessageAdapter): Promise<MessageValue> {
        const key = this.keyForMessage(threadKey, adapter);
        const record = await this.read([key]);
        return record[key] || {};
    }

    async writeMessage(threadKey: string, adapter: MessageAdapter, value: MessageValue): Promise<void> {
        const key = this.keyForMessage(threadKey, adapter);
        await this.write({ [key]: value });
    }
}

const storageService = new StorageService();

const EXT_ATTR = 'data-ext-owned';
const CONTENT_CONFIG_STORAGE_KEY = '__tagalyst_config';
const contentDefaultConfig = {
    searchEnabled: true,
    tagsEnabled: true,
};
let config = { ...contentDefaultConfig };
let configLoaded = false;
let searchToggleEl: HTMLElement | null = null;
let tagToggleEl: HTMLElement | null = null;
let activeThreadAdapter: ThreadAdapter | null = null;

/**
 * Augments the bootstrap function with stateful fields used across modules.
 */
type BootstrapWithMeta = ((...args: unknown[]) => Promise<void>) & {
    _requestRefresh?: () => void;
    _raf?: number;
};

type MessageValue = Record<string, any>;

type MessageMeta = {
    key: string | null;
    value: MessageValue;
    pairIndex: number | null;
    adapter: MessageAdapter | null;
};

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
 * Flags a DOM node as extension-managed so MutationObservers can ignore it.
 */
function markExtNode(el: Element | null) {
    if (el?.setAttribute) {
        el.setAttribute(EXT_ATTR, '1');
    }
}

/**
 * Walks up from the provided node to see if any ancestor belongs to the extension.
 */
function closestExtNode(node: Node | null) {
    if (!node) return null;
    if (node.nodeType === Node.ELEMENT_NODE && typeof (node as Element).closest === 'function') {
        return (node as Element).closest(`[${EXT_ATTR}]`);
    }
    const parent = node.parentElement;
    if (parent && typeof parent.closest === 'function') {
        return parent.closest(`[${EXT_ATTR}]`);
    }
    return null;
}

/**
 * Returns true when the supplied node is part of extension-owned UI.
 */
function isExtensionNode(node: Node | null) {
    return !!closestExtNode(node);
}

/**
 * Determines whether a mutation record affects host content rather than extension nodes.
 */
function mutationTouchesExternal(record: MutationRecord) {
    if (!isExtensionNode(record.target)) return true;
    for (const node of record.addedNodes) {
        if (!isExtensionNode(node)) return true;
    }
    for (const node of record.removedNodes) {
        if (!isExtensionNode(node)) return true;
    }
    return false;
}

/**
 * Indicates whether the Search pane is currently enabled via options.
 */
function isSearchEnabled() {
    return !!config.searchEnabled;
}

/**
 * Indicates whether the Tags pane is currently enabled via options.
 */
function areTagsEnabled() {
    return !!config.tagsEnabled;
}

/**
 * Triggers a queued refresh run if the bootstrap helper exposes that hook.
 */
function requestRefresh() {
    const boot = bootstrap as BootstrapWithMeta;
    if (typeof bootstrap === 'function' && typeof boot._requestRefresh === 'function') {
        boot._requestRefresh();
    }
}

/**
 * Applies config toggles to in-memory focus state and any existing inputs.
 */
function enforceConfigState() {
    let changed = false;
    if (!isSearchEnabled()) {
        focusService.setSearchQuery('');
        if (searchInputEl) searchInputEl.value = '';
        changed = true;
    }
    if (!areTagsEnabled()) {
        focusService.clearTags();
        changed = true;
    }
    if (changed) syncFocusMode();
}

/**
 * Loads config data into the runtime state and refreshes dependent UI.
 */
function applyConfigObject(obj?: Partial<typeof contentDefaultConfig>) {
    config = { ...contentDefaultConfig, ...(obj || {}) };
    enforceConfigState();
    updateConfigUI();
    syncFocusMode();
    requestRefresh();
}

/**
 * Lazily reads persisted config the first time it is requested.
 */
async function ensureConfigLoaded(): Promise<typeof contentDefaultConfig> {
    if (configLoaded) return config;
    const store = await getStore([CONTENT_CONFIG_STORAGE_KEY]);
    applyConfigObject(store[CONTENT_CONFIG_STORAGE_KEY]);
    configLoaded = true;
    return config;
}

/**
 * Syncs Search/Tag pane DOM visibility and states with the current config.
 */
function updateConfigUI() {
    const searchPanel = topPanelsEl?.querySelector<HTMLElement>('.ext-top-search');
    const tagPanel = topPanelsEl?.querySelector<HTMLElement>('.ext-top-tags');
    if (searchPanel) searchPanel.style.display = isSearchEnabled() ? '' : 'none';
    if (tagPanel) tagPanel.style.display = areTagsEnabled() ? '' : 'none';
    if (searchInputEl) {
        const enabled = isSearchEnabled();
        searchInputEl.disabled = !enabled;
        searchInputEl.placeholder = enabled ? 'Search messages…' : 'Search disabled in Options';
        if (!enabled) searchInputEl.value = '';
    }
    if (tagListEl) {
        tagListEl.classList.toggle('ext-tags-disabled', !areTagsEnabled());
    }
}

// ------------------------ Focus State ------------------------
/**
 * Clears focus-related caches and returns the UI to its default state.
 */
function resetFocusState() {
    focusService.reset();
    searchInputEl = null;
    pageControls = null;
    messageState.clear();
}

/**
 * Provides a human-readable label for the current focus mode.
 */
function describeFocusMode() {
    return focusService.describeMode();
}

/**
 * Returns the glyph pair (empty/filled) for the given mode plus toggle state.
 */
function getFocusGlyph(isFilled: boolean) {
    return focusService.getGlyph(isFilled);
}

/**
 * Ensures each message node has tracked metadata (storage key, tag data, etc.).
 */
function ensureMessageMeta(el: HTMLElement, key?: string | null, adapter?: MessageAdapter | null) {
    let meta = messageState.get(el);
    if (!meta) {
        meta = { key: key || null, value: {}, pairIndex: null, adapter: adapter || null };
        messageState.set(el, meta);
    }
    if (key) meta.key = key;
    if (adapter) meta.adapter = adapter;
    return meta;
}

/**
 * Updates cached metadata for a message node and returns the stored entry.
 */
function setMessageMeta(el: HTMLElement, { key, value, pairIndex, adapter }: { key?: string | null; value?: MessageValue; pairIndex?: number | null; adapter?: MessageAdapter | null } = {}) {
    const meta = ensureMessageMeta(el, key || null, adapter ?? null);
    if (typeof pairIndex === 'number') {
        meta.pairIndex = pairIndex;
    } else if (pairIndex === null) {
        meta.pairIndex = null;
    }
    if (value) meta.value = value;
    return meta;
}

function resolveAdapterForElement(el: HTMLElement): MessageAdapter {
    const meta = ensureMessageMeta(el);
    if (meta.adapter && meta.adapter.element === el) {
        return meta.adapter;
    }
    const adapter = new DomMessageAdapter(el);
    meta.adapter = adapter;
    return adapter;
}

/**
 * Determines whether the stored value includes any of the currently selected tags.
 */
function updateFocusButton(el: HTMLElement, meta: MessageMeta) {
    const btn = el.querySelector<HTMLButtonElement>('.ext-toolbar .ext-focus-button');
    if (!btn) return;
    const active = focusService.isMessageFocused(meta, el);
    const glyph = getFocusGlyph(active);
    if (btn.textContent !== glyph) btn.textContent = glyph;
    const pressed = String(active);
    if (btn.getAttribute('aria-pressed') !== pressed) {
        btn.setAttribute('aria-pressed', pressed);
    }
    const focusDesc = describeFocusMode();
    const interactive = focusService.getMode() === FOCUS_MODES.STARS;
    const disabled = !interactive;
    if (btn.disabled !== disabled) {
        if (disabled) {
            btn.setAttribute('disabled', 'true');
        } else {
            btn.removeAttribute('disabled');
        }
    }
    if (interactive) {
        const title = active ? 'Remove bookmark' : 'Bookmark message';
        if (btn.title !== title) {
            btn.title = title;
            btn.setAttribute('aria-label', title);
        }
    } else {
        const title = active ? `Matches ${focusDesc}` : `Does not match ${focusDesc}`;
        if (btn.title !== title) {
            btn.title = title;
            btn.setAttribute('aria-label', title);
        }
    }
}

/**
 * Recomputes toolbar button labels for every tracked message node.
 */
function refreshFocusButtons() {
    messageState.forEach((meta, el) => {
        if (!document.contains(el)) {
            messageState.delete(el);
            return;
        }
        if (!meta.adapter) {
            meta.adapter = new DomMessageAdapter(el);
        }
        updateFocusButton(el, meta);
    });
}

/**
 * Re-evaluates which focus mode is active and updates dependent UI affordances.
 */
function syncFocusMode() {
    focusService.syncMode();
    refreshFocusButtons();
    updateFocusControlsUI();
    syncTagSidebarSelectionUI();
}

/**
 * Returns the list of message adapters that currently match the focus filter.
 */
function getFocusMatches(): MessageAdapter[] {
    return focusService.getMatches(messageState);
}

/**
 * Returns a short user-facing label for whichever focus type is active.
 */
function focusSetLabel() {
    return focusService.getModeLabel();
}

/**
 * Updates the main navigation controls so their icons/titles match focus state.
 */
function updateFocusControlsUI() {
    if (!pageControls) return;
    const mode = focusService.getMode();
    const glyph = focusGlyphs[mode] || focusGlyphs[FOCUS_MODES.STARS];
    const desc = focusSetLabel();
    if (pageControls.focusPrev) {
        pageControls.focusPrev.textContent = `${glyph.filled}↑`;
        pageControls.focusPrev.title = `Previous ${desc}`;
    }
    if (pageControls.focusNext) {
        pageControls.focusNext.textContent = `${glyph.filled}↓`;
        pageControls.focusNext.title = `Next ${desc}`;
    }
    if (pageControls.collapseNonFocus) {
        pageControls.collapseNonFocus.textContent = glyph.empty;
        pageControls.collapseNonFocus.title = `Collapse messages outside current ${desc}s`;
    }
    if (pageControls.expandFocus) {
        pageControls.expandFocus.textContent = glyph.filled;
        pageControls.expandFocus.title = `Expand current ${desc}s`;
    }
    if (pageControls.exportFocus) {
        pageControls.exportFocus.textContent = glyph.filled;
        pageControls.exportFocus.title = `Copy Markdown for current ${desc}s`;
    }
}

/**
 * Highlights any tag rows in the sidebar that belong to the selected tag set.
 */
function syncTagSidebarSelectionUI() {
    if (!tagListEl) return;
    tagListEl.querySelectorAll<HTMLElement>('.ext-tag-sidebar-row').forEach(row => {
        const tag = row.dataset.tag;
        row.classList.toggle('ext-tag-selected', !!(tag && focusService.isTagSelected(tag)));
    });
}

/**
 * Handles updates from the search input and re-syncs focus mode.
 */
function handleSearchInput(value: string) {
    if (!isSearchEnabled()) return;
    focusService.setSearchQuery(value || '');
    syncFocusMode();
}

/**
 * Adds or removes a tag from the selected set, then recalculates focus mode.
 */
function toggleTagSelection(tag: string) {
    if (!areTagsEnabled()) return;
    focusService.toggleTag(tag);
    syncFocusMode();
}

// ------------------------ Inline Editors ------------------------
let tagListEl: HTMLElement | null = null;
let topPanelsEl: HTMLElement | null = null;
let searchInputEl: HTMLInputElement | null = null;

const FOCUS_MODES = Object.freeze({
    STARS: 'stars',
    TAGS: 'tags',
    SEARCH: 'search',
} as const);

type FocusMode = typeof FOCUS_MODES[keyof typeof FOCUS_MODES];

const focusGlyphs: Record<FocusMode, { empty: string; filled: string }> = {
    [FOCUS_MODES.STARS]: { empty: '☆', filled: '★' },
    [FOCUS_MODES.TAGS]: { empty: '○', filled: '●' },
    [FOCUS_MODES.SEARCH]: { empty: '□', filled: '■' },
};

class FocusService {
    private mode: FocusMode = FOCUS_MODES.STARS;
    private readonly selectedTags = new Set<string>();
    private searchQuery = '';
    private searchQueryLower = '';
    private navIndex = -1;

    reset() {
        this.selectedTags.clear();
        this.searchQuery = '';
        this.searchQueryLower = '';
        this.mode = FOCUS_MODES.STARS;
        this.navIndex = -1;
    }

    setSearchQuery(raw: string) {
        const normalized = (raw || '').trim();
        this.searchQuery = normalized;
        this.searchQueryLower = normalized.toLowerCase();
    }

    toggleTag(tag: string) {
        if (!tag) return;
        if (this.selectedTags.has(tag)) {
            this.selectedTags.delete(tag);
        } else {
            this.selectedTags.add(tag);
        }
    }

    clearTags() {
        if (this.selectedTags.size) {
            this.selectedTags.clear();
        }
    }

    isTagSelected(tag: string): boolean {
        return this.selectedTags.has(tag);
    }

    getTags(): string[] {
        return Array.from(this.selectedTags);
    }

    getSearchQuery(): string {
        return this.searchQuery;
    }

    getMode(): FocusMode {
        return this.mode;
    }

    describeMode(): string {
        switch (this.mode) {
            case FOCUS_MODES.TAGS:
                return 'selected tags';
            case FOCUS_MODES.SEARCH:
                return 'search results';
            default:
                return 'starred items';
        }
    }

    getModeLabel(): string {
        switch (this.mode) {
            case FOCUS_MODES.TAGS:
                return 'tagged message';
            case FOCUS_MODES.SEARCH:
                return 'search hit';
            default:
                return 'starred message';
        }
    }

    getGlyph(isFilled: boolean): string {
        const glyph = focusGlyphs[this.mode] || focusGlyphs[FOCUS_MODES.STARS];
        return isFilled ? glyph.filled : glyph.empty;
    }

    computeMode(): FocusMode {
        if (isSearchEnabled() && this.searchQueryLower) return FOCUS_MODES.SEARCH;
        if (areTagsEnabled() && this.selectedTags.size) return FOCUS_MODES.TAGS;
        return FOCUS_MODES.STARS;
    }

    syncMode() {
        this.mode = this.computeMode();
        this.navIndex = -1;
    }

    isMessageFocused(meta: MessageMeta, el: HTMLElement): boolean {
        switch (this.mode) {
            case FOCUS_MODES.TAGS:
                return this.matchesSelectedTags(meta.value);
            case FOCUS_MODES.SEARCH:
                return this.matchesSearch(meta, el);
            default:
                return !!meta.value?.starred;
        }
    }

    getMatches(state: Map<HTMLElement, MessageMeta>): MessageAdapter[] {
        const matches: MessageAdapter[] = [];
        state.forEach((meta, el) => {
            if (!document.contains(el)) {
                state.delete(el);
                return;
            }
            const adapter = meta.adapter || resolveAdapterForElement(el);
            if (this.isMessageFocused(meta, el)) {
                matches.push(adapter);
            }
        });
        return matches;
    }

    adjustNav(delta: number, total: number): number {
        if (total <= 0) {
            this.navIndex = -1;
            return this.navIndex;
        }
        if (this.navIndex < 0 || this.navIndex >= total) {
            this.navIndex = delta >= 0 ? 0 : total - 1;
        } else {
            this.navIndex = Math.max(0, Math.min(this.navIndex + delta, total - 1));
        }
        return this.navIndex;
    }

    private matchesSelectedTags(value: MessageValue): boolean {
        if (!areTagsEnabled() || !this.selectedTags.size) return false;
        const tags = Array.isArray(value?.tags) ? value.tags : [];
        if (!tags.length) return false;
        return tags.some(tag => this.selectedTags.has(tag));
    }

    private matchesSearch(meta: MessageMeta, el: HTMLElement): boolean {
        if (!this.searchQueryLower) return false;
        const adapter = meta.adapter;
        const textSource = adapter ? adapter.getText() : normalizeText(el?.innerText || '');
        const text = textSource.toLowerCase();
        return text.includes(this.searchQueryLower);
    }
}

const focusService = new FocusService();

class EditorController {
    private activeTagEditor: ActiveEditor | null = null;
    private activeNoteEditor: ActiveEditor | null = null;

    constructor(private readonly storage: StorageService) { }

    teardown() {
        this.closeTagEditor();
        this.closeNoteEditor();
    }

    private closeTagEditor() {
        if (this.activeTagEditor) {
            this.activeTagEditor.cleanup();
            this.activeTagEditor = null;
        }
    }

    private closeNoteEditor() {
        if (this.activeNoteEditor) {
            this.activeNoteEditor.cleanup();
            this.activeNoteEditor = null;
        }
    }

    async openTagEditor(messageEl: HTMLElement, threadKey: string) {
        if (this.activeTagEditor?.message === messageEl) {
            this.closeTagEditor();
            return;
        }
        this.closeTagEditor();

        const adapter = resolveAdapterForElement(messageEl);
        const cur = await this.storage.readMessage(threadKey, adapter);
        const existing = Array.isArray(cur.tags) ? cur.tags.join(', ') : '';

        const editor = document.createElement('div');
        editor.className = 'ext-tag-editor';
        markExtNode(editor);
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
        const detachFloating = mountFloatingEditor(editor, (toolbar || messageEl) as HTMLElement);
        messageEl.classList.add('ext-tag-editing');
        input.focus();
        placeCaretAtEnd(input);

        const cleanup = () => {
            detachFloating();
            editor.remove();
            messageEl.classList.remove('ext-tag-editing');
            if (this.activeTagEditor?.message === messageEl) this.activeTagEditor = null;
        };

        const save = async () => {
            const raw = input.innerText.replace(/\n+/g, ',');
            const tags = raw.split(',').map(s => s.trim()).filter(Boolean);
            cur.tags = tags;
            await this.storage.writeMessage(threadKey, adapter, cur);
            renderBadges(messageEl, threadKey, cur, adapter);
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

    async openNoteEditor(messageEl: HTMLElement, threadKey: string) {
        if (this.activeNoteEditor?.message === messageEl) {
            this.closeNoteEditor();
            return;
        }
        this.closeNoteEditor();

        const adapter = resolveAdapterForElement(messageEl);
        const cur = await this.storage.readMessage(threadKey, adapter);
        const existing = typeof cur.note === 'string' ? cur.note : '';

        const editor = document.createElement('div');
        editor.className = 'ext-note-editor';
        markExtNode(editor);
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
        const detachFloating = mountFloatingEditor(editor, (toolbar || messageEl) as HTMLElement);
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
            renderBadges(messageEl, threadKey, cur, adapter);
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
}

const editorController = new EditorController(storageService);

const messageState = new Map<HTMLElement, MessageMeta>();
let pageControls: PageControls | null = null;

/**
 * Removes extension DOM nodes and clears transient editor state.
 */
function teardownUI() {
    editorController.teardown();
    document.querySelectorAll('.ext-tag-editor').forEach(editor => editor.remove());
    document.querySelectorAll('.ext-note-editor').forEach(editor => editor.remove());
    document.querySelectorAll('.ext-toolbar-row').forEach(tb => tb.remove());
    document.querySelectorAll('.ext-tag-editing').forEach(el => el.classList.remove('ext-tag-editing'));
    document.querySelectorAll('.ext-note-editing').forEach(el => el.classList.remove('ext-note-editing'));
    tagListEl = null;
    const controls = document.getElementById('ext-page-controls');
    if (controls) controls.remove();
    if (topPanelsEl) {
        topPanelsEl.remove();
        topPanelsEl = null;
    }
    resetFocusState();
    activeThreadAdapter?.disconnect();
    activeThreadAdapter = null;
}


/**
 * Moves the caret to the end of a contenteditable element.
 */
function placeCaretAtEnd(el: HTMLElement) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
}

/**
 * Positions floating editor UI relative to an anchor and keeps it in view.
 */
function mountFloatingEditor(editor: HTMLElement, anchor: HTMLElement): () => void {
    editor.classList.add('ext-floating-editor');
    markExtNode(editor);
    document.body.appendChild(editor);

    const clamp = (val: number, min: number, max: number) => Math.min(Math.max(val, min), max);

    const update = () => {
        const rect = anchor.getBoundingClientRect();
        const width = Math.min(420, window.innerWidth - 32);
        editor.style.width = `${width}px`;
        const baseTop = window.scrollY + rect.top + 16;
        const maxTop = window.scrollY + window.innerHeight - editor.offsetHeight - 16;
        const top = clamp(baseTop, window.scrollY + 16, maxTop);
        const baseLeft = window.scrollX + rect.right - width;
        const minLeft = window.scrollX + 16;
        const maxLeft = window.scrollX + window.innerWidth - width - 16;
        const left = clamp(baseLeft, minLeft, maxLeft);
        editor.style.top = `${top}px`;
        editor.style.left = `${left}px`;
    };

    const onScroll = () => update();
    const onResize = () => update();

    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    update();

    return () => {
        window.removeEventListener('scroll', onScroll, true);
        window.removeEventListener('resize', onResize);
        editor.classList.remove('ext-floating-editor');
    };
}

// --------------------- Discovery & Enumeration -----------------
/**
 * Finds the primary scrollable container that holds the conversation.
 */
function findTranscriptRoot(): HTMLElement {
    return activeThreadAdapter?.getTranscriptRoot() ?? defaultFindTranscriptRoot();
}

function defaultFindTranscriptRoot(): HTMLElement {
    const main = (document.querySelector('main') as HTMLElement) || document.body;
    const candidates = Array.from(main.querySelectorAll<HTMLElement>('*')).filter(el => {
        const s = getComputedStyle(el);
        const scrollable = s.overflowY === 'auto' || s.overflowY === 'scroll';
        return scrollable && el.clientHeight > 300 && el.children.length > 1;
    });
    // Pick the largest scrollable area; fallback to main
    return (candidates.sort((a, b) => b.clientHeight - a.clientHeight)[0]) || main;
}

/**
 * Heuristic message detector used only when the explicit role attribute is absent.
 */
function isMessageNode(el: HTMLElement) {
    if (!el || !el.parentElement) return false;
    if (el.querySelector('form, textarea, [contenteditable="true"]')) return false; // composer region
    const textLen = (el.innerText || '').trim().length;
    if (textLen < 8) return false;
    // Heuristics: rich text or code, and likely large block
    return !!el.querySelector('pre, code, p, li, h1, h2, h3') || textLen > 80;
}

/**
 * Returns all message nodes, preferring the native role attribute.
 */
function enumerateMessages(root: HTMLElement): HTMLElement[] {
    const adapters = activeThreadAdapter?.getMessages(root);
    if (adapters) return adapters.map(adapter => adapter.element);
    return defaultEnumerateMessages(root);
}

function defaultEnumerateMessages(root: HTMLElement): HTMLElement[] {
    const attrMatches = Array.from(root.querySelectorAll<HTMLElement>('[data-message-author-role]'));
    if (attrMatches.length) return attrMatches;

    // Fallback to heuristic block detection if the explicit attribute is absent.
    const out = [];
    for (const child of Array.from(root.children)) {
        if (isMessageNode(child as HTMLElement)) out.push(child as HTMLElement);
    }
    return out;
}

/**
 * Groups message DOM nodes into ordered (query, response) pairs.
 */
function derivePairs(messages: HTMLElement[]): TagalystPair[] {
    return defaultDerivePairs(messages);
}

function defaultDerivePairs(messages: HTMLElement[]): TagalystPair[] {
    const pairs: TagalystPair[] = [];
    for (let i = 0; i < messages.length; i += 2) {
        const query = messages[i];
        if (!query) break;
        const response = messages[i + 1] || null;
        pairs.push({
            query,
            response,
            queryId: getMessageId(query),
            responseId: response ? getMessageId(response) : null,
        });
    }
    return pairs;
}

/**
 * Returns every (query, response) pair within the current thread container.
 */
function getPairs(root: HTMLElement): TagalystPair[] {
    const adapterPairs = activeThreadAdapter?.getPairs(root);
    if (adapterPairs) return adapterPairs.map(toTagalystPair);
    return defaultGetPairs(root);
}

function defaultGetPairs(root: HTMLElement): TagalystPair[] {
    return defaultDerivePairs(defaultEnumerateMessages(root));
}

/**
 * Returns only the prompt (user query) nodes.
 */
function getPromptNodes(root: HTMLElement): HTMLElement[] {
    const adapters = activeThreadAdapter?.getPromptMessages(root);
    if (adapters) return adapters.map(adapter => adapter.element);
    return defaultGetPromptNodes(root);
}

function defaultGetPromptNodes(root: HTMLElement): HTMLElement[] {
    return defaultGetPairs(root).map(p => p.query).filter(Boolean) as HTMLElement[];
}

/**
 * Returns nodes used for navigation (prompts when available, otherwise all messages).
 */
function getNavigationNodes(root: HTMLElement): HTMLElement[] {
    const adapters = activeThreadAdapter?.getNavigationMessages(root);
    if (adapters) return adapters.map(adapter => adapter.element);
    return defaultGetNavigationNodes(root);
}

function defaultGetNavigationNodes(root: HTMLElement): HTMLElement[] {
    const prompts = defaultGetPromptNodes(root);
    if (prompts.length) return prompts;
    return defaultEnumerateMessages(root);
}

/**
 * Returns the p-th pair (0-indexed) or null if it does not exist.
 */
function getPair(root: HTMLElement, idx: number): TagalystPair | null {
    const adapterPair = activeThreadAdapter?.getPairAt(root, idx);
    if (adapterPair) return toTagalystPair(adapterPair);
    return defaultGetPair(root, idx);
}

function defaultGetPair(root: HTMLElement, idx: number): TagalystPair | null {
    if (idx < 0) return null;
    return defaultGetPairs(root)[idx] || null;
}

function toTagalystPair(pair: PairAdapter): TagalystPair {
    const queryEl = pair.query?.element || null;
    const responseEl = pair.response?.element || null;
    return {
        query: queryEl,
        response: responseEl,
        queryId: queryEl ? getMessageId(queryEl) : null,
        responseId: responseEl ? getMessageId(responseEl) : null,
    };
}

class DomMessageAdapter implements MessageAdapter {
    readonly key: string;
    readonly role: string;

    constructor(readonly element: HTMLElement) {
        this.key = keyForMessage(element);
        this.role = element.getAttribute('data-message-author-role') || 'unknown';
    }

    getText(): string {
        return normalizeText(this.element.innerText || '');
    }

    shouldShowCollapse(): boolean {
        return shouldShowCollapseControl(this.element);
    }

    storageKey(threadKey: string): string {
        return `${threadKey}:${this.key}`;
    }
}

class DomPairAdapter implements PairAdapter {
    constructor(
        readonly index: number,
        readonly query: MessageAdapter | null,
        readonly response: MessageAdapter | null,
    ) { }

    getMessages(): MessageAdapter[] {
        return [this.query, this.response].filter(Boolean) as MessageAdapter[];
    }
}

function buildDomPairAdaptersFromMessages(messages: MessageAdapter[]): DomPairAdapter[] {
    const pairs: DomPairAdapter[] = [];
    for (let i = 0; i < messages.length; i += 2) {
        const query = messages[i] || null;
        const response = messages[i + 1] || null;
        pairs.push(new DomPairAdapter(pairs.length, query, response));
    }
    return pairs;
}

class ChatGptThreadAdapter implements ThreadAdapter {
    private observer: MutationObserver | null = null;

    getTranscriptRoot(): HTMLElement | null {
        return defaultFindTranscriptRoot();
    }

    getMessages(root: HTMLElement): MessageAdapter[] {
        return this.buildMessageAdapters(root);
    }

    getPairs(root: HTMLElement): PairAdapter[] {
        return this.buildPairAdapters(root);
    }

    getPromptMessages(root: HTMLElement): MessageAdapter[] {
        return this.buildPairAdapters(root)
            .map(pair => pair.query)
            .filter(Boolean) as MessageAdapter[];
    }

    getNavigationMessages(root: HTMLElement): MessageAdapter[] {
        const prompts = this.getPromptMessages(root);
        if (prompts.length) return prompts;
        return this.buildMessageAdapters(root);
    }

    getPairAt(root: HTMLElement, index: number): PairAdapter | null {
        const pairs = this.buildPairAdapters(root);
        if (index < 0 || index >= pairs.length) return null;
        return pairs[index];
    }

    observe(root: HTMLElement, callback: MutationCallback): void {
        this.disconnect();
        this.observer = new MutationObserver(callback);
        this.observer.observe(root, { childList: true, subtree: true });
    }

    disconnect(): void {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
    }

    private buildMessageAdapters(root: HTMLElement): DomMessageAdapter[] {
        return defaultEnumerateMessages(root).map(el => new DomMessageAdapter(el));
    }

    private buildPairAdapters(root: HTMLElement): DomPairAdapter[] {
        const messages = this.buildMessageAdapters(root);
        return buildDomPairAdaptersFromMessages(messages);
    }
}

class ToolbarController {
    constructor(private readonly focus: FocusService, private readonly storage: StorageService) { }

    ensurePageControls(container: HTMLElement, threadKey: string) {
        const existing = document.getElementById('ext-page-controls');
        if (existing) existing.remove();
        const box = document.createElement('div');
        box.id = 'ext-page-controls';
        markExtNode(box);
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
        syncTopPanelWidth();

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
                const nodes = getNavigationNodes(container);
                if (!nodes.length) return;
                this.scrollToNode(container, nodes.length - 1, 'end', nodes);
            };
        }
        if (jumpStarPrevBtn) jumpStarPrevBtn.onclick = () => { this.scrollFocus(-1); };
        if (jumpStarNextBtn) jumpStarNextBtn.onclick = () => { this.scrollFocus(1); };
        if (collapseAllBtn) collapseAllBtn.onclick = () => toggleAll(container, true);
        if (collapseUnstarredBtn) collapseUnstarredBtn.onclick = () => collapseByFocus(container, 'out', true);
        if (expandAllBtn) expandAllBtn.onclick = () => toggleAll(container, false);
        if (expandStarredBtn) expandStarredBtn.onclick = () => collapseByFocus(container, 'in', false);

        if (exportAllBtn) exportAllBtn.onclick = () => runExport(container, false);
        if (exportStarredBtn) exportStarredBtn.onclick = () => runExport(container, true);

        pageControls = {
            root: box,
            focusPrev: jumpStarPrevBtn,
            focusNext: jumpStarNextBtn,
            collapseNonFocus: collapseUnstarredBtn,
            expandFocus: expandStarredBtn,
            exportFocus: exportStarredBtn,
        };
        updateFocusControlsUI();
    }

    private scrollToNode(container: HTMLElement, idx: number, block: ScrollLogicalPosition = 'center', list?: HTMLElement[]) {
        const nodes = list || getNavigationNodes(container);
        if (!nodes.length) return;
        const clamped = Math.max(0, Math.min(idx, nodes.length - 1));
        const target = nodes[clamped];
        if (target) target.scrollIntoView({ behavior: 'smooth', block });
    }

    private scrollFocus(delta: number) {
        const adapters = getFocusMatches();
        if (!adapters.length) return;
        const idx = this.focus.adjustNav(delta, adapters.length);
        if (idx < 0 || idx >= adapters.length) return;
        const target = adapters[idx];
        if (target) target.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    injectToolbar(el: HTMLElement, threadKey: string) {
        let toolbar = el.querySelector<HTMLElement>('.ext-toolbar');
        if (toolbar) {
            if (toolbar.dataset.threadKey !== threadKey) {
                toolbar.closest('.ext-toolbar-row')?.remove();
                toolbar = null;
            } else {
                updateCollapseVisibility(el);
                return;
            }
        }

        const row = document.createElement('div');
        row.className = 'ext-toolbar-row';
        markExtNode(row);
        const wrap = document.createElement('div');
        wrap.className = 'ext-toolbar';
        markExtNode(wrap);
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
            collapseBtn.onclick = () => collapse(el, !el.classList.contains('ext-collapsed'));
        }
        if (focusBtn) {
            focusBtn.onclick = async () => {
                if (this.focus.getMode() !== FOCUS_MODES.STARS) return;
                const adapter = resolveAdapterForElement(el);
                const cur = await this.storage.readMessage(threadKey, adapter);
                cur.starred = !cur.starred;
                await this.storage.writeMessage(threadKey, adapter, cur);
                renderBadges(el, threadKey, cur, adapter);
                updateFocusControlsUI();
            };
        }
        if (tagBtn) tagBtn.onclick = () => editorController.openTagEditor(el, threadKey);
        if (noteBtn) noteBtn.onclick = () => editorController.openNoteEditor(el, threadKey);

        wrap.dataset.threadKey = threadKey;
        el.prepend(row);
        ensureUserToolbarButton(el);
        updateCollapseVisibility(el);
        syncCollapseButton(el);
    }
}

const toolbarController = new ToolbarController(focusService, storageService);

/**
 * Reads star/tag data for a message and updates its badges + CSS state.
 */
function renderBadges(el: HTMLElement, threadKey: string, value: MessageValue, adapter?: MessageAdapter | null) {
    const adapterRef = adapter ?? resolveAdapterForElement(el);
    const k = `${threadKey}:${adapterRef.key}`;
    const cur = value || {};
    const meta = setMessageMeta(el, { key: k, value: cur, adapter: adapterRef });
    const badges = el.querySelector<HTMLElement>('.ext-badges');
    if (!badges) return;

    // starred visual state
    const starred = !!cur.starred;
    el.classList.toggle('ext-starred', starred);

    // render tags
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
    updateFocusButton(el, meta);
}

/**
 * Placeholder handler fired when the per-user custom toolbar button is pressed.
 */
function handleUserToolbarButtonClick(messageEl: HTMLElement) {
    const messageKey = resolveAdapterForElement(messageEl).key;
    console.info('[Tagalyst] User toolbar button clicked', { messageKey });
}

/**
 * Adds a user-only toolbar button to a message when applicable.
 */
function ensureUserToolbarButton(el: HTMLElement): HTMLButtonElement | null {
    const row = el.querySelector<HTMLElement>('.ext-toolbar-row');
    if (!row) return null;
    const role = el?.getAttribute?.('data-message-author-role');
    const existing = row.querySelector<HTMLButtonElement>('.ext-user-toolbar-button');
    if (role !== 'user') {
        if (existing) existing.remove();
        return null;
    }
    if (existing) return existing;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ext-user-toolbar-button';
    btn.title = 'Tagalyst user action';
    btn.setAttribute('aria-label', 'Tagalyst user action');
    btn.textContent = '>';
    btn.addEventListener('click', (evt) => {
        evt.stopPropagation();
        handleUserToolbarButtonClick(el);
    });
    row.appendChild(btn);
    return btn;
}

/**
 * Renders the left-aligned pair index badge for user messages.
 */
function ensurePairNumber(adapter: MessageAdapter, pairIndex: number | null) {
    const el = adapter.element;
    ensureUserToolbarButton(el);
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
 * Toggles the collapse control visibility based on heuristics for the message.
 */
function updateCollapseVisibility(el: HTMLElement) {
    const btn = el.querySelector<HTMLButtonElement>('.ext-toolbar .ext-collapse');
    if (!btn) return;
    const show = shouldShowCollapseControl(el);
    btn.style.display = show ? '' : 'none';
}

/**
 * Updates collapse button glyph/title so it reflects the message state.
 */
function syncCollapseButton(el: HTMLElement) {
    const btn = el.querySelector<HTMLButtonElement>('.ext-toolbar .ext-collapse');
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
function collapse(el: HTMLElement, yes: boolean) {
    el.classList.toggle('ext-collapsed', !!yes);
    syncCollapseButton(el);
}

/**
 * Applies collapse/expand state to every discovered message.
 */
function toggleAll(container: HTMLElement, yes: boolean) {
    const msgs = enumerateMessages(container);
    for (const m of msgs) collapse(m, !!yes);
}

/**
 * Applies collapse state against the current focus subset.
 */
function collapseByFocus(container: HTMLElement, target: 'in' | 'out', collapseState: boolean) {
    const matches = getFocusMatches();
    if (!matches.length) return;
    const matchSet = new Set(matches.map(adapter => adapter.element));
    for (const el of enumerateMessages(container)) {
        const isMatch = matchSet.has(el);
        if (target === 'in' ? isMatch : !isMatch) {
            collapse(el, collapseState);
        }
    }
}

// ---------------------- Orchestration --------------------------
/**
 * Entry point: finds the thread, injects UI, and watches for updates.
 */
async function bootstrap(): Promise<void> {
    // Wait a moment for the app shell to mount
    await sleep(600);
    await ensureConfigLoaded();
    teardownUI();
    const adapter = new ChatGptThreadAdapter();
    activeThreadAdapter = adapter;
    const container = findTranscriptRoot();

    const threadKey = getThreadKey();
    toolbarController.ensurePageControls(container, threadKey);
    ensureTopPanels();

    let refreshRunning = false;
    let refreshQueued = false;

    async function refresh() {
        if (refreshRunning) {
            refreshQueued = true;
            return;
        }
        refreshRunning = true;
        try {
            do {
                refreshQueued = false;
                const threadAdapter = activeThreadAdapter;
                const messageAdapters = (threadAdapter
                    ? threadAdapter.getMessages(container)
                    : defaultEnumerateMessages(container).map(el => new DomMessageAdapter(el)));
                const pairAdapters = (threadAdapter
                    ? threadAdapter.getPairs(container)
                    : buildDomPairAdaptersFromMessages(messageAdapters));
                const pairMap = new Map<MessageAdapter, number>();
                pairAdapters.forEach((pair, idx) => {
                    pair.getMessages().forEach(msg => pairMap.set(msg, idx));
                });
    const entries = messageAdapters.map(messageAdapter => ({
        adapter: messageAdapter,
        el: messageAdapter.element,
        key: messageAdapter.storageKey(threadKey),
        pairIndex: pairMap.get(messageAdapter) ?? null,
    }));
                if (!entries.length) break;
                const keys = entries.map(e => e.key);
                const store = await storageService.read(keys);
                const tagCounts = new Map<string, number>();
                messageState.clear();
                for (const { adapter: messageAdapter, el, key, pairIndex } of entries) {
                    toolbarController.injectToolbar(el, threadKey);
                    ensurePairNumber(messageAdapter, typeof pairIndex === 'number' ? pairIndex : null);
                    const value = store[key] || {};
                    setMessageMeta(el, { key, value, pairIndex, adapter: messageAdapter });
                    if (value && Array.isArray(value.tags)) {
                        for (const t of value.tags) {
                            if (!t) continue;
                            tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
                        }
                    }
                    renderBadges(el, threadKey, value, messageAdapter);
                }
                const sortedTags = Array.from(tagCounts.entries())
                    .map(([tag, count]) => ({ tag, count }))
                    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
                updateTagList(sortedTags);
                refreshFocusButtons();
            } while (refreshQueued);
        } finally {
            refreshRunning = false;
        }
    }

    const requestRefresh = () => {
        const boot = bootstrap as BootstrapWithMeta;
        if (boot._raf) cancelAnimationFrame(boot._raf);
        boot._raf = requestAnimationFrame(refresh);
    };
    const boot = bootstrap as BootstrapWithMeta;
    boot._requestRefresh = requestRefresh;

    // Initial pass and observe for changes
    refresh();
    adapter.observe(container, (records) => {
        if (!records.some(mutationTouchesExternal)) return;
        requestRefresh();
    });
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
        const root = findTranscriptRoot();
        return getPairs(root);
    },
    getThreadPair: (idx: number): TagalystPair | null => {
        const root = findTranscriptRoot();
        return getPair(root, idx);
    },
}) as TagalystApi;

// First boot
bootstrap();
/**
 * Creates or returns the floating Search/Tags panel container.
 */
function ensureTopPanels(): HTMLElement {
    if (topPanelsEl) return topPanelsEl;
    const wrap = document.createElement('div');
    wrap.id = 'ext-top-panels';
    wrap.innerHTML = `
        <div class="ext-top-frame ext-top-search">
            <span class="ext-top-label">Search</span>
            <input type="text" class="ext-search-input" placeholder="Search messages…" />
        </div>
        <div class="ext-top-frame ext-top-tags">
            <span class="ext-top-label">Tags</span>
            <div class="ext-tag-list" id="ext-tag-list"></div>
        </div>
    `;
    markExtNode(wrap);
    document.body.appendChild(wrap);
    topPanelsEl = wrap;
    tagListEl = wrap.querySelector<HTMLElement>('#ext-tag-list');
    searchInputEl = wrap.querySelector<HTMLInputElement>('.ext-search-input');
    if (searchInputEl) {
        searchInputEl.value = focusService.getSearchQuery();
        searchInputEl.addEventListener('input', (evt) => {
            const target = evt.target as HTMLInputElement;
            handleSearchInput(target.value);
        });
    }
    updateConfigUI();
    syncTopPanelWidth();
    return wrap;
}

/**
 * Rebuilds the tag list UI with the latest frequency counts.
 */
function updateTagList(counts: Array<{ tag: string; count: number }>) {
    ensureTopPanels();
    if (!tagListEl) return;
    tagListEl.innerHTML = '';
    tagListEl.classList.toggle('ext-tags-disabled', !areTagsEnabled());
    if (!counts.length) {
        const empty = document.createElement('div');
        empty.className = 'ext-tag-sidebar-empty';
        empty.textContent = 'No tags yet';
        tagListEl.appendChild(empty);
        return;
    }
    for (const { tag, count } of counts) {
        const row = document.createElement('div');
        row.className = 'ext-tag-sidebar-row';
        row.dataset.tag = tag;
        const label = document.createElement('span');
        label.className = 'ext-tag-sidebar-tag';
        label.textContent = tag;
        const badge = document.createElement('span');
        badge.className = 'ext-tag-sidebar-count';
        badge.textContent = String(count);
        row.append(label, badge);
        row.classList.toggle('ext-tag-selected', focusService.isTagSelected(tag));
        row.addEventListener('click', () => toggleTagSelection(tag));
        tagListEl.appendChild(row);
    }
    syncTagSidebarSelectionUI();
}

/**
 * Generates Markdown for the current thread and writes it to the clipboard.
 */
function runExport(container: HTMLElement, focusOnly: boolean) {
    try {
        const md = exportThreadToMarkdown(container, focusOnly);
        navigator.clipboard.writeText(md).catch(err => console.error('Export failed', err));
    } catch (err) {
        console.error('Export failed', err);
    }
}

/**
 * Builds a Markdown document for the thread, optionally limited to focus matches.
 */
function exportThreadToMarkdown(container: HTMLElement, focusOnly: boolean): string {
    const pairs = getPairs(container);
    const sections = [];
    pairs.forEach((pair, idx) => {
        const num = idx + 1;
        const isFocused = focusOnly ? isPairFocused(pair) : true;
        if (focusOnly && !isFocused) return;
        const query = pair.query ? pair.query.innerText.trim() : '';
        const response = pair.response ? pair.response.innerText.trim() : '';
        const lines = [];
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

/**
 * Determines whether any node within a (query, response) pair is currently focused.
 */
function isPairFocused(pair: TagalystPair) {
    const nodes = [];
    if (pair.query) nodes.push(pair.query);
    if (pair.response) nodes.push(pair.response);
    return nodes.some(node => {
        const meta = messageState.get(node);
        if (!meta) return false;
        return focusService.isMessageFocused(meta, node);
    });
}

/**
 * Keeps the Search/Tags panel width aligned with the bottom controls.
 */
function syncTopPanelWidth() {
    if (!topPanelsEl) return;
    const controls = document.getElementById('ext-page-controls');
    const refWidth = controls ? controls.getBoundingClientRect().width : null;
    const width = refWidth && refWidth > 0 ? refWidth : topPanelsEl.getBoundingClientRect().width || 200;
    topPanelsEl.style.width = `${Math.max(100, Math.round(width))}px`;
}

if (chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;
        const change = changes[CONTENT_CONFIG_STORAGE_KEY];
        if (!change) return;
        applyConfigObject(change.newValue);
    });
}
