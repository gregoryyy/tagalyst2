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
async function getStore(keys: string[]): Promise<Record<string, MessageValue>> {
    if (!Array.isArray(keys) || !keys.length) return {};
    return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

/**
 * Promise-wrapped chrome.storage.local set.
 */
async function setStore(obj: Record<string, MessageValue>): Promise<void> {
    return new Promise(resolve => chrome.storage.local.set(obj, () => resolve()));
}

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
    if (!isSearchEnabled()) {
        focusState.searchQuery = '';
        focusState.searchQueryLower = '';
        if (searchInputEl) searchInputEl.value = '';
    }
    if (!areTagsEnabled()) {
        focusState.selectedTags.clear();
    }
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
    focusState.selectedTags.clear();
    focusState.searchQuery = '';
    focusState.searchQueryLower = '';
    focusState.mode = FOCUS_MODES.STARS;
    searchInputEl = null;
    pageControls = null;
    messageState.clear();
}

/**
 * Determines which focus mode should drive navigation and filtering.
 */
function computeFocusMode() {
    if (isSearchEnabled() && focusState.searchQueryLower) return FOCUS_MODES.SEARCH;
    if (areTagsEnabled() && focusState.selectedTags.size) return FOCUS_MODES.TAGS;
    return FOCUS_MODES.STARS;
}

/**
 * Provides a human-readable label for the current focus mode.
 */
function describeFocusMode() {
    switch (focusState.mode) {
        case FOCUS_MODES.TAGS:
            return 'selected tags';
        case FOCUS_MODES.SEARCH:
            return 'search results';
        default:
            return 'starred items';
    }
}

/**
 * Returns the glyph pair (empty/filled) for the given mode plus toggle state.
 */
function getFocusGlyph(isFilled: boolean) {
    const glyph = focusGlyphs[focusState.mode] || focusGlyphs[FOCUS_MODES.STARS];
    return isFilled ? glyph.filled : glyph.empty;
}

/**
 * Ensures each message node has tracked metadata (storage key, tag data, etc.).
 */
function ensureMessageMeta(el: HTMLElement, key?: string | null) {
    let meta = messageState.get(el);
    if (!meta) {
        meta = { key: key || null, value: {}, pairIndex: null };
        messageState.set(el, meta);
    }
    if (key) meta.key = key;
    return meta;
}

/**
 * Updates cached metadata for a message node and returns the stored entry.
 */
function setMessageMeta(el: HTMLElement, { key, value, pairIndex }: { key?: string | null; value?: MessageValue; pairIndex?: number | null } = {}) {
    const meta = ensureMessageMeta(el, key || null);
    if (typeof pairIndex === 'number') {
        meta.pairIndex = pairIndex;
    } else if (pairIndex === null) {
        meta.pairIndex = null;
    }
    if (value) meta.value = value;
    return meta;
}

/**
 * Determines whether the stored value includes any of the currently selected tags.
 */
function matchesSelectedTags(value: MessageValue) {
    if (!areTagsEnabled() || !focusState.selectedTags.size) return false;
    const tags = Array.isArray(value?.tags) ? value.tags : [];
    if (!tags.length) return false;
    return tags.some(tag => focusState.selectedTags.has(tag));
}

/**
 * Performs a text match against the active search query for the supplied node.
 */
function matchesSearchQuery(el: HTMLElement) {
    const query = focusState.searchQueryLower;
    if (!query) return false;
    const text = normalizeText(el?.innerText || '').toLowerCase();
    return text.includes(query);
}

/**
 * Tests whether a message should be considered part of the active focus set.
 */
function isMessageFocused(el: HTMLElement, value: MessageValue) {
    switch (focusState.mode) {
        case FOCUS_MODES.TAGS:
            return matchesSelectedTags(value);
        case FOCUS_MODES.SEARCH:
            return matchesSearchQuery(el);
        default:
            return !!value?.starred;
    }
}

/**
 * Synchronizes the per-message focus button with star/search/tag state.
 */
function updateFocusButton(el: HTMLElement, value: MessageValue) {
    const btn = el.querySelector<HTMLButtonElement>('.ext-toolbar .ext-focus-button');
    if (!btn) return;
    const active = isMessageFocused(el, value);
    const glyph = getFocusGlyph(active);
    if (btn.textContent !== glyph) btn.textContent = glyph;
    const pressed = String(active);
    if (btn.getAttribute('aria-pressed') !== pressed) {
        btn.setAttribute('aria-pressed', pressed);
    }
    const focusDesc = describeFocusMode();
    const interactive = focusState.mode === FOCUS_MODES.STARS;
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
    messageState.forEach(({ value }, el) => {
        if (!document.contains(el)) {
            messageState.delete(el);
            return;
        }
        updateFocusButton(el, value || {});
    });
}

/**
 * Re-evaluates which focus mode is active and updates dependent UI affordances.
 */
function syncFocusMode() {
    focusState.mode = computeFocusMode();
    focusNavIndex = -1;
    refreshFocusButtons();
    updateFocusControlsUI();
    syncTagSidebarSelectionUI();
}

/**
 * Returns the list of DOM nodes that currently match the focus filter.
 */
function getFocusMatches(): HTMLElement[] {
    const nodes = [];
    messageState.forEach(({ value }, el) => {
        if (document.contains(el) && isMessageFocused(el, value || {})) {
            nodes.push(el);
        }
    });
    return nodes;
}

/**
 * Returns a short user-facing label for whichever focus type is active.
 */
function focusSetLabel() {
    switch (focusState.mode) {
        case FOCUS_MODES.TAGS:
            return 'tagged message';
        case FOCUS_MODES.SEARCH:
            return 'search hit';
        default:
            return 'starred message';
    }
}

/**
 * Updates the main navigation controls so their icons/titles match focus state.
 */
function updateFocusControlsUI() {
    if (!pageControls) return;
    const glyph = focusGlyphs[focusState.mode] || focusGlyphs[FOCUS_MODES.STARS];
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
        row.classList.toggle('ext-tag-selected', !!(tag && focusState.selectedTags.has(tag)));
    });
}

/**
 * Handles updates from the search input and re-syncs focus mode.
 */
function handleSearchInput(value: string) {
    if (!isSearchEnabled()) return;
    const normalized = (value || '').trim();
    focusState.searchQuery = normalized;
    focusState.searchQueryLower = normalized.toLowerCase();
    syncFocusMode();
}

/**
 * Adds or removes a tag from the selected set, then recalculates focus mode.
 */
function toggleTagSelection(tag: string) {
    if (!areTagsEnabled()) return;
    if (!tag) return;
    if (focusState.selectedTags.has(tag)) {
        focusState.selectedTags.delete(tag);
    } else {
        focusState.selectedTags.add(tag);
    }
    syncFocusMode();
}

// ------------------------ Inline Editors ------------------------
let activeTagEditor: ActiveEditor | null = null;
let activeNoteEditor: ActiveEditor | null = null;
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

type FocusState = {
    mode: FocusMode;
    selectedTags: Set<string>;
    searchQuery: string;
    searchQueryLower: string;
};

const focusState: FocusState = {
    mode: FOCUS_MODES.STARS,
    selectedTags: new Set<string>(),
    searchQuery: '',
    searchQueryLower: '',
};

const messageState = new Map<HTMLElement, MessageMeta>();
let pageControls: PageControls | null = null;
let focusNavIndex = -1;

/**
 * Closes any open inline tag editor and resets associated state.
 */
function closeActiveTagEditor() {
    if (activeTagEditor) {
        activeTagEditor.cleanup();
        activeTagEditor = null;
    }
}

/**
 * Closes any open inline note editor and resets associated state.
 */
function closeActiveNoteEditor() {
    if (activeNoteEditor) {
        activeNoteEditor.cleanup();
        activeNoteEditor = null;
    }
}

/**
 * Removes extension DOM nodes and clears transient editor state.
 */
function teardownUI() {
    closeActiveTagEditor();
    closeActiveNoteEditor();
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

async function openInlineTagEditor(messageEl: HTMLElement, threadKey: string) {
    if (activeTagEditor?.message === messageEl) {
        closeActiveTagEditor();
        return;
    }
    closeActiveTagEditor();

    const key = `${threadKey}:${keyForMessage(messageEl)}`;
    const store = await getStore([key]);
    const cur = store[key] || {};
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
        if (activeTagEditor?.message === messageEl) activeTagEditor = null;
    };

    const save = async () => {
        const raw = input.innerText.replace(/\n+/g, ',');
        const tags = raw.split(',').map(s => s.trim()).filter(Boolean);
        cur.tags = tags;
        await setStore({ [key]: cur });
        renderBadges(messageEl, threadKey, cur);
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
    const outsideTag = (evt) => {
        if (!editor.contains(evt.target)) {
            cancel();
            document.removeEventListener('mousedown', outsideTag, true);
        }
    };
    document.addEventListener('mousedown', outsideTag, true);

    activeTagEditor = { message: messageEl, cleanup };
}

async function openInlineNoteEditor(messageEl: HTMLElement, threadKey: string) {
    if (activeNoteEditor?.message === messageEl) {
        closeActiveNoteEditor();
        return;
    }
    closeActiveNoteEditor();

    const key = `${threadKey}:${keyForMessage(messageEl)}`;
    const store = await getStore([key]);
    const cur = store[key] || {};
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
        if (activeNoteEditor?.message === messageEl) activeNoteEditor = null;
    };

    const save = async () => {
        const value = input.value.trim();
        if (value) {
            cur.note = value;
        } else {
            delete cur.note;
        }
        await setStore({ [key]: cur });
        renderBadges(messageEl, threadKey, cur);
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
    const outsideNote = (evt) => {
        if (!editor.contains(evt.target)) {
            cancel();
            document.removeEventListener('mousedown', outsideNote, true);
        }
    };
    document.addEventListener('mousedown', outsideNote, true);

    activeNoteEditor = { message: messageEl, cleanup };
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
    return activeThreadAdapter?.getMessages(root) ?? defaultEnumerateMessages(root);
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
    return activeThreadAdapter?.getPairs(root) ?? defaultGetPairs(root);
}

function defaultGetPairs(root: HTMLElement): TagalystPair[] {
    return defaultDerivePairs(defaultEnumerateMessages(root));
}

/**
 * Returns only the prompt (user query) nodes.
 */
function getPromptNodes(root: HTMLElement): HTMLElement[] {
    return activeThreadAdapter?.getPromptNodes(root) ?? defaultGetPromptNodes(root);
}

function defaultGetPromptNodes(root: HTMLElement): HTMLElement[] {
    return defaultGetPairs(root).map(p => p.query).filter(Boolean) as HTMLElement[];
}

/**
 * Returns nodes used for navigation (prompts when available, otherwise all messages).
 */
function getNavigationNodes(root: HTMLElement): HTMLElement[] {
    return activeThreadAdapter?.getNavigationNodes(root) ?? defaultGetNavigationNodes(root);
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
    return activeThreadAdapter?.getPair(root, idx) ?? defaultGetPair(root, idx);
}

function defaultGetPair(root: HTMLElement, idx: number): TagalystPair | null {
    if (idx < 0) return null;
    return defaultGetPairs(root)[idx] || null;
}

class ChatGptThreadAdapter implements ThreadAdapter {
    private observer: MutationObserver | null = null;

    getTranscriptRoot(): HTMLElement | null {
        return defaultFindTranscriptRoot();
    }

    getMessages(root: HTMLElement): HTMLElement[] {
        return defaultEnumerateMessages(root);
    }

    getPairs(root: HTMLElement): TagalystPair[] {
        return defaultGetPairs(root);
    }

    getPromptNodes(root: HTMLElement): HTMLElement[] {
        return defaultGetPromptNodes(root);
    }

    getNavigationNodes(root: HTMLElement): HTMLElement[] {
        return defaultGetNavigationNodes(root);
    }

    getPair(root: HTMLElement, index: number): TagalystPair | null {
        return defaultGetPair(root, index);
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
}

// ---------------------- UI Injection ---------------------------
/**
 * Injects global page controls once per document.
 */
function ensurePageControls(container: HTMLElement, threadKey: string) {
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

    /**
     * Scrolls to the indexed node (or nearest valid node) within the supplied list.
     */
    function scrollToNode(idx: number, block: ScrollLogicalPosition = 'center', list?: HTMLElement[]) {
        const nodes = list || getNavigationNodes(container);
        if (!nodes.length) return;
        const clamped = Math.max(0, Math.min(idx, nodes.length - 1));
        const target = nodes[clamped];
        if (target) target.scrollIntoView({ behavior: 'smooth', block });
    }

    /**
     * Moves the focus navigation cursor forward/backward and scrolls into view.
     */
    function scrollFocus(delta: number) {
        const nodes = getFocusMatches();
        if (!nodes.length) return;
        if (focusNavIndex < 0 || focusNavIndex >= nodes.length) {
            focusNavIndex = delta >= 0 ? 0 : nodes.length - 1;
        } else {
            focusNavIndex = Math.max(0, Math.min(focusNavIndex + delta, nodes.length - 1));
        }
        const target = nodes[focusNavIndex];
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

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

    if (jumpFirstBtn) jumpFirstBtn.onclick = () => scrollToNode(0, 'start');
    if (jumpLastBtn) {
        jumpLastBtn.onclick = () => {
            const nodes = getNavigationNodes(container);
            if (!nodes.length) return;
            scrollToNode(nodes.length - 1, 'end', nodes);
        };
    }
    if (jumpStarPrevBtn) jumpStarPrevBtn.onclick = () => { scrollFocus(-1); };
    if (jumpStarNextBtn) jumpStarNextBtn.onclick = () => { scrollFocus(1); };
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

/**
 * Prepends the per-message toolbar and wires its handlers.
 */
function injectToolbar(el: HTMLElement, threadKey: string) {
    let toolbar = el.querySelector<HTMLElement>('.ext-toolbar');
    if (toolbar) {
        if (toolbar.dataset.threadKey !== threadKey) {
            toolbar.closest('.ext-toolbar-row')?.remove();
            toolbar = null;
        } else {
            updateCollapseVisibility(el);
            return; // already wired for this thread
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

    // Events
    const collapseBtn = wrap.querySelector<HTMLButtonElement>('.ext-collapse');
    const focusBtn = wrap.querySelector<HTMLButtonElement>('.ext-focus-button');
    const tagBtn = wrap.querySelector<HTMLButtonElement>('.ext-tag');
    const noteBtn = wrap.querySelector<HTMLButtonElement>('.ext-note');

    if (collapseBtn) {
        collapseBtn.onclick = () => collapse(el, !el.classList.contains('ext-collapsed'));
    }
    if (focusBtn) {
        focusBtn.onclick = async () => {
            if (focusState.mode !== FOCUS_MODES.STARS) return;
            const k = `${threadKey}:${keyForMessage(el)}`;
            const cur = (await getStore([k]))[k] || {};
            cur.starred = !cur.starred;
            await setStore({ [k]: cur });
            renderBadges(el, threadKey, cur);
            updateFocusControlsUI();
        };
    }
    if (tagBtn) tagBtn.onclick = () => openInlineTagEditor(el, threadKey);
    if (noteBtn) noteBtn.onclick = () => openInlineNoteEditor(el, threadKey);

    wrap.dataset.threadKey = threadKey;
    el.prepend(row);
    toolbar = wrap;
    ensureUserToolbarButton(el);
    updateCollapseVisibility(el);
    syncCollapseButton(el);
}

/**
 * Reads star/tag data for a message and updates its badges + CSS state.
 */
function renderBadges(el: HTMLElement, threadKey: string, value: MessageValue) {
    const k = `${threadKey}:${keyForMessage(el)}`;
    const cur = value || {};
    setMessageMeta(el, { key: k, value: cur });
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
    updateFocusButton(el, cur);
}

/**
 * Placeholder handler fired when the per-user custom toolbar button is pressed.
 */
function handleUserToolbarButtonClick(messageEl: HTMLElement) {
    const messageKey = keyForMessage(messageEl);
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
function ensurePairNumber(el: HTMLElement, pairIndex: number | null) {
    const role = el?.getAttribute?.('data-message-author-role');
    ensureUserToolbarButton(el);
    if (role !== 'user') {
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
    const matchSet = new Set(matches);
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
    ensurePageControls(container, threadKey);
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
                const msgs = enumerateMessages(container);
                const pairMap = new Map<HTMLElement, number>();
                const pairs = getPairs(container);
                pairs.forEach((pair, idx) => {
                    if (pair.query) pairMap.set(pair.query, idx);
                    if (pair.response) pairMap.set(pair.response, idx);
                });
                const entries = msgs.map(el => ({
                    el,
                    key: `${threadKey}:${keyForMessage(el)}`,
                    pairIndex: pairMap.get(el)
                }));
                if (!entries.length) break;
                const keys = entries.map(e => e.key);
                const store = await getStore(keys);
                const tagCounts = new Map<string, number>();
                messageState.clear();
                for (const { el, key, pairIndex } of entries) {
                    injectToolbar(el, threadKey);
                    ensurePairNumber(el, pairIndex);
                    const value = store[key] || {};
                    setMessageMeta(el, { key, value, pairIndex });
                    if (value && Array.isArray(value.tags)) {
                        for (const t of value.tags) {
                            if (!t) continue;
                            tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
                        }
                    }
                    renderBadges(el, threadKey, value);
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
        searchInputEl.value = focusState.searchQuery;
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
        row.classList.toggle('ext-tag-selected', focusState.selectedTags.has(tag));
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
        return isMessageFocused(node, meta?.value || {});
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
