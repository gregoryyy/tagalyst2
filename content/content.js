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
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Produces a deterministic 32-bit FNV-1a hash for lightweight keys.
 */
function hashString(s) {
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
function normalizeText(t) {
    return (t || "")
        .replace(/\s+/g, " ")
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .trim();
}

/**
 * Generates a thread-level key using the conversation ID when available.
 */
function getThreadKey() {
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
function getMessageId(el) {
    return el?.getAttribute?.('data-message-id') || null;
}

/**
 * Stable-ish per-message key derived from ChatGPT IDs or fallback heuristics.
 */
function keyForMessage(el) {
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
function shouldShowCollapseControl(el) {
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
async function getStore(keys) {
    if (!Array.isArray(keys) || !keys.length) return {};
    return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

/**
 * Promise-wrapped chrome.storage.local set.
 */
async function setStore(obj) {
    return new Promise(resolve => chrome.storage.local.set(obj, resolve));
}

const EXT_ATTR = 'data-ext-owned';
const CONFIG_STORAGE_KEY = '__tagalyst_config';
const defaultConfig = {
    searchEnabled: true,
    tagsEnabled: true,
};
let config = { ...defaultConfig };
let configLoaded = false;
let searchToggleEl = null;
let tagToggleEl = null;

function markExtNode(el) {
    if (el?.setAttribute) {
        el.setAttribute(EXT_ATTR, '1');
    }
}

function closestExtNode(node) {
    if (!node) return null;
    if (node.nodeType === Node.ELEMENT_NODE && typeof node.closest === 'function') {
        return node.closest(`[${EXT_ATTR}]`);
    }
    const parent = node.parentElement;
    if (parent && typeof parent.closest === 'function') {
        return parent.closest(`[${EXT_ATTR}]`);
    }
    return null;
}

function isExtensionNode(node) {
    return !!closestExtNode(node);
}

function mutationTouchesExternal(record) {
    if (!isExtensionNode(record.target)) return true;
    for (const node of record.addedNodes) {
        if (!isExtensionNode(node)) return true;
    }
    for (const node of record.removedNodes) {
        if (!isExtensionNode(node)) return true;
    }
    return false;
}

function isSearchEnabled() {
    return !!config.searchEnabled;
}

function areTagsEnabled() {
    return !!config.tagsEnabled;
}

function requestRefresh() {
    if (typeof bootstrap === 'function' && typeof bootstrap._requestRefresh === 'function') {
        bootstrap._requestRefresh();
    }
}

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

function applyConfigObject(obj) {
    config = { ...defaultConfig, ...(obj || {}) };
    enforceConfigState();
    updateConfigUI();
    syncFocusMode();
    requestRefresh();
}

async function ensureConfigLoaded() {
    if (configLoaded) return config;
    const store = await getStore([CONFIG_STORAGE_KEY]);
    applyConfigObject(store[CONFIG_STORAGE_KEY]);
    configLoaded = true;
    return config;
}

function updateConfigUI() {
    const searchPanel = topPanelsEl?.querySelector('.ext-top-search');
    const tagPanel = topPanelsEl?.querySelector('.ext-top-tags');
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
function resetFocusState() {
    focusState.selectedTags.clear();
    focusState.searchQuery = '';
    focusState.searchQueryLower = '';
    focusState.mode = FOCUS_MODES.STARS;
    searchInputEl = null;
    pageControls = null;
    messageState.clear();
}

function computeFocusMode() {
    if (isSearchEnabled() && focusState.searchQueryLower) return FOCUS_MODES.SEARCH;
    if (areTagsEnabled() && focusState.selectedTags.size) return FOCUS_MODES.TAGS;
    return FOCUS_MODES.STARS;
}

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

function getFocusGlyph(isFilled) {
    const glyph = focusGlyphs[focusState.mode] || focusGlyphs[FOCUS_MODES.STARS];
    return isFilled ? glyph.filled : glyph.empty;
}

function ensureMessageMeta(el, key) {
    let meta = messageState.get(el);
    if (!meta) {
        meta = { key: key || null, value: {}, pairIndex: null };
        messageState.set(el, meta);
    }
    if (key) meta.key = key;
    return meta;
}

function setMessageMeta(el, { key, value, pairIndex }) {
    const meta = ensureMessageMeta(el, key);
    if (typeof pairIndex === 'number') meta.pairIndex = pairIndex;
    if (value) meta.value = value;
    return meta;
}

function matchesSelectedTags(value) {
    if (!areTagsEnabled() || !focusState.selectedTags.size) return false;
    const tags = Array.isArray(value?.tags) ? value.tags : [];
    if (!tags.length) return false;
    return tags.some(tag => focusState.selectedTags.has(tag));
}

function matchesSearchQuery(el) {
    const query = focusState.searchQueryLower;
    if (!query) return false;
    const text = normalizeText(el?.innerText || '').toLowerCase();
    return text.includes(query);
}

function isMessageFocused(el, value) {
    switch (focusState.mode) {
        case FOCUS_MODES.TAGS:
            return matchesSelectedTags(value);
        case FOCUS_MODES.SEARCH:
            return matchesSearchQuery(el);
        default:
            return !!value?.starred;
    }
}

function updateFocusButton(el, value) {
    const btn = el.querySelector('.ext-toolbar .ext-focus-button');
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

function refreshFocusButtons() {
    messageState.forEach(({ value }, el) => {
        if (!document.contains(el)) {
            messageState.delete(el);
            return;
        }
        updateFocusButton(el, value || {});
    });
}

function syncFocusMode() {
    focusState.mode = computeFocusMode();
    focusNavIndex = -1;
    refreshFocusButtons();
    updateFocusControlsUI();
    syncTagSidebarSelectionUI();
}

function getFocusMatches() {
    const nodes = [];
    messageState.forEach(({ value }, el) => {
        if (document.contains(el) && isMessageFocused(el, value || {})) {
            nodes.push(el);
        }
    });
    return nodes;
}

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

function syncTagSidebarSelectionUI() {
    if (!tagListEl) return;
    tagListEl.querySelectorAll('.ext-tag-sidebar-row').forEach(row => {
        const tag = row.dataset.tag;
        row.classList.toggle('ext-tag-selected', !!(tag && focusState.selectedTags.has(tag)));
    });
}

function handleSearchInput(value) {
    if (!isSearchEnabled()) return;
    const normalized = (value || '').trim();
    focusState.searchQuery = normalized;
    focusState.searchQueryLower = normalized.toLowerCase();
    syncFocusMode();
}

function toggleTagSelection(tag) {
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
let activeTagEditor = null;
let activeNoteEditor = null;
let tagListEl = null;
let topPanelsEl = null;
let searchInputEl = null;

const FOCUS_MODES = Object.freeze({
    STARS: 'stars',
    TAGS: 'tags',
    SEARCH: 'search',
});

const focusGlyphs = {
    [FOCUS_MODES.STARS]: { empty: '☆', filled: '★' },
    [FOCUS_MODES.TAGS]: { empty: '○', filled: '●' },
    [FOCUS_MODES.SEARCH]: { empty: '□', filled: '■' },
};

const focusState = {
    mode: FOCUS_MODES.STARS,
    selectedTags: new Set(),
    searchQuery: '',
    searchQueryLower: '',
};

const messageState = new Map();
let pageControls = null;
let focusNavIndex = -1;

function closeActiveTagEditor() {
    if (activeTagEditor) {
        activeTagEditor.cleanup();
        activeTagEditor = null;
    }
}

function closeActiveNoteEditor() {
    if (activeNoteEditor) {
        activeNoteEditor.cleanup();
        activeNoteEditor = null;
    }
}

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
    if (bootstrap._observer) {
        bootstrap._observer.disconnect();
        bootstrap._observer = null;
    }
}

async function openInlineTagEditor(messageEl, threadKey) {
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

    const input = editor.querySelector('.ext-tag-editor-input');
    input.textContent = existing;

    const toolbar = messageEl.querySelector('.ext-toolbar');
    const detachFloating = mountFloatingEditor(editor, toolbar || messageEl);
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

    editor.querySelector('.ext-tag-editor-save').onclick = save;
    editor.querySelector('.ext-tag-editor-cancel').onclick = cancel;
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

async function openInlineNoteEditor(messageEl, threadKey) {
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

    const input = editor.querySelector('.ext-note-input');
    input.value = existing;

    const toolbar = messageEl.querySelector('.ext-toolbar');
    const detachFloating = mountFloatingEditor(editor, toolbar || messageEl);
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

    editor.querySelector('.ext-note-save').onclick = save;
    editor.querySelector('.ext-note-cancel').onclick = cancel;
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

function placeCaretAtEnd(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
}

function mountFloatingEditor(editor, anchor) {
    editor.classList.add('ext-floating-editor');
    markExtNode(editor);
    document.body.appendChild(editor);

    const clamp = (val, min, max) => Math.min(Math.max(val, min), max);

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
function findTranscriptRoot() {
    const main = document.querySelector('main') || document.body;
    const candidates = Array.from(main.querySelectorAll('*')).filter(el => {
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
function isMessageNode(el) {
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
function enumerateMessages(root) {
    const attrMatches = Array.from(root.querySelectorAll('[data-message-author-role]'));
    if (attrMatches.length) return attrMatches;

    // Fallback to heuristic block detection if the explicit attribute is absent.
    const out = [];
    for (const child of root.children) {
        if (isMessageNode(child)) out.push(child);
    }
    return out;
}

/**
 * Groups message DOM nodes into ordered (query, response) pairs.
 */
function derivePairs(messages) {
    const pairs = [];
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
function getPairs(root) {
    return derivePairs(enumerateMessages(root));
}

/**
 * Returns only the prompt (user query) nodes.
 */
function getPromptNodes(root) {
    return getPairs(root).map(p => p.query).filter(Boolean);
}

/**
 * Returns nodes used for navigation (prompts when available, otherwise all messages).
 */
function getNavigationNodes(root) {
    const prompts = getPromptNodes(root);
    if (prompts.length) return prompts;
    return enumerateMessages(root);
}

/**
 * Returns the p-th pair (0-indexed) or null if it does not exist.
 */
function getPair(root, idx) {
    if (idx < 0) return null;
    return getPairs(root)[idx] || null;
}

// ---------------------- UI Injection ---------------------------
/**
 * Injects global page controls once per document.
 */
function ensurePageControls(container, threadKey) {
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

    function scrollToNode(idx, block = 'center', list) {
        const nodes = list || getNavigationNodes(container);
        if (!nodes.length) return;
        const clamped = Math.max(0, Math.min(idx, nodes.length - 1));
        const target = nodes[clamped];
        if (target) target.scrollIntoView({ behavior: 'smooth', block });
    }

    function scrollFocus(delta) {
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

    box.querySelector('#ext-jump-first').onclick = () => scrollToNode(0, 'start');
    box.querySelector('#ext-jump-last').onclick = () => {
        const nodes = getNavigationNodes(container);
        if (!nodes.length) return;
        scrollToNode(nodes.length - 1, 'end', nodes);
    };
    box.querySelector('#ext-jump-star-prev').onclick = () => { scrollFocus(-1); };
    box.querySelector('#ext-jump-star-next').onclick = () => { scrollFocus(1); };
    box.querySelector('#ext-collapse-all').onclick = () => toggleAll(container, true);
    box.querySelector('#ext-collapse-unstarred').onclick = () => collapseByFocus(container, 'out', true);
    box.querySelector('#ext-expand-all').onclick = () => toggleAll(container, false);
    box.querySelector('#ext-expand-starred').onclick = () => collapseByFocus(container, 'in', false);

    box.querySelector('#ext-export-all').onclick = () => runExport(container, false);
    box.querySelector('#ext-export-starred').onclick = () => runExport(container, true);

    pageControls = {
        root: box,
        focusPrev: box.querySelector('#ext-jump-star-prev'),
        focusNext: box.querySelector('#ext-jump-star-next'),
        collapseNonFocus: box.querySelector('#ext-collapse-unstarred'),
        expandFocus: box.querySelector('#ext-expand-starred'),
        exportFocus: box.querySelector('#ext-export-starred'),
    };
    updateFocusControlsUI();
}

/**
 * Prepends the per-message toolbar and wires its handlers.
 */
function injectToolbar(el, threadKey) {
    let toolbar = el.querySelector('.ext-toolbar');
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
    wrap.querySelector('.ext-collapse').onclick = () => collapse(el, !el.classList.contains('ext-collapsed'));
    wrap.querySelector('.ext-focus-button').onclick = async () => {
        if (focusState.mode !== FOCUS_MODES.STARS) return;
        const k = `${threadKey}:${keyForMessage(el)}`;
        const cur = (await getStore([k]))[k] || {};
        cur.starred = !cur.starred;
        await setStore({ [k]: cur });
        renderBadges(el, threadKey, cur);
        updateFocusControlsUI();
    };
    wrap.querySelector('.ext-tag').onclick = () => openInlineTagEditor(el, threadKey);
    wrap.querySelector('.ext-note').onclick = () => openInlineNoteEditor(el, threadKey);

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
function renderBadges(el, threadKey, value) {
    const k = `${threadKey}:${keyForMessage(el)}`;
    const cur = value || {};
    setMessageMeta(el, { key: k, value: cur });
    const badges = el.querySelector('.ext-badges');
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

function handleUserToolbarButtonClick(messageEl) {
    const messageKey = keyForMessage(messageEl);
    console.info('[Tagalyst] User toolbar button clicked', { messageKey });
}

function ensureUserToolbarButton(el) {
    const row = el.querySelector('.ext-toolbar-row');
    if (!row) return;
    const role = el?.getAttribute?.('data-message-author-role');
    const existing = row.querySelector('.ext-user-toolbar-button');
    if (role !== 'user') {
        if (existing) existing.remove();
        return;
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

function ensurePairNumber(el, pairIndex) {
    const role = el?.getAttribute?.('data-message-author-role');
    ensureUserToolbarButton(el);
    if (role !== 'user') {
        const wrap = el.querySelector('.ext-pair-number-wrap');
        if (wrap) wrap.remove();
        return;
    }
    if (typeof pairIndex !== 'number') return;
    const row = el.querySelector('.ext-toolbar-row');
    if (!row) return;
    let wrap = row.querySelector('.ext-pair-number-wrap');
    if (!wrap) {
        wrap = document.createElement('div');
        wrap.className = 'ext-pair-number-wrap';
        row.insertBefore(wrap, row.firstChild);
    }
    let badge = wrap.querySelector('.ext-pair-number');
    if (!badge) {
        badge = document.createElement('span');
        badge.className = 'ext-pair-number';
        wrap.appendChild(badge);
    }
    badge.textContent = `${pairIndex + 1}.`;
}

function updateCollapseVisibility(el) {
    const btn = el.querySelector('.ext-toolbar .ext-collapse');
    if (!btn) return;
    const show = shouldShowCollapseControl(el);
    btn.style.display = show ? '' : 'none';
}

function syncCollapseButton(el) {
    const btn = el.querySelector('.ext-toolbar .ext-collapse');
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
function collapse(el, yes) {
    el.classList.toggle('ext-collapsed', !!yes);
    syncCollapseButton(el);
}

/**
 * Applies collapse/expand state to every discovered message.
 */
function toggleAll(container, yes) {
    const msgs = enumerateMessages(container);
    for (const m of msgs) collapse(m, !!yes);
}

/**
 * Applies collapse state against the current focus subset.
 */
function collapseByFocus(container, target, collapseState) {
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
async function bootstrap() {
    // Wait a moment for the app shell to mount
    await sleep(600);
    await ensureConfigLoaded();
    teardownUI();
    const container = findTranscriptRoot();
    if (!container) return;

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
                const pairMap = new Map();
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
                const tagCounts = new Map();
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
        if (bootstrap._raf) cancelAnimationFrame(bootstrap._raf);
        bootstrap._raf = requestAnimationFrame(refresh);
    };
    bootstrap._requestRefresh = requestRefresh;

    // Initial pass and observe for changes
    refresh();
    const mo = new MutationObserver((records) => {
        if (!records.some(mutationTouchesExternal)) return;
        requestRefresh();
    });
    mo.observe(container, { childList: true, subtree: true });
    bootstrap._observer = mo;
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
    getThreadPairs: () => {
        const root = findTranscriptRoot();
        return root ? getPairs(root) : [];
    },
    getThreadPair: (idx) => {
        const root = findTranscriptRoot();
        return root ? getPair(root, idx) : null;
    },
});

// First boot
bootstrap();
function ensureTopPanels() {
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
    tagListEl = wrap.querySelector('#ext-tag-list');
    searchInputEl = wrap.querySelector('.ext-search-input');
    if (searchInputEl) {
        searchInputEl.value = focusState.searchQuery;
        searchInputEl.addEventListener('input', (evt) => handleSearchInput(evt.target.value));
    }
    updateConfigUI();
    syncTopPanelWidth();
    return wrap;
}

function updateTagList(counts) {
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
        badge.textContent = count;
        row.append(label, badge);
        row.classList.toggle('ext-tag-selected', focusState.selectedTags.has(tag));
        row.addEventListener('click', () => toggleTagSelection(tag));
        tagListEl.appendChild(row);
    }
    syncTagSidebarSelectionUI();
}

function runExport(container, focusOnly) {
    try {
        const md = exportThreadToMarkdown(container, focusOnly);
        navigator.clipboard.writeText(md).catch(err => console.error('Export failed', err));
    } catch (err) {
        console.error('Export failed', err);
    }
}

function exportThreadToMarkdown(container, focusOnly) {
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

function isPairFocused(pair) {
    const nodes = [];
    if (pair.query) nodes.push(pair.query);
    if (pair.response) nodes.push(pair.response);
    return nodes.some(node => {
        const meta = messageState.get(node);
        return isMessageFocused(node, meta?.value || {});
    });
}

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
        const change = changes[CONFIG_STORAGE_KEY];
        if (!change) return;
        applyConfigObject(change.newValue);
    });
}
