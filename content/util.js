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

