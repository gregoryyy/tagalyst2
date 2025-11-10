/**
 * Creates a deterministic 32-bit FNV-1a hash suitable for lightweight IDs.
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
 * Normalizes whitespace/zero-width characters so comparisons stay stable.
 */
function normalizeText(t) {
    return (t || "")
        .replace(/\s+/g, " ")
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .trim();
}

/**
 * Derives a thread-scoped key based on URL or page title as fallback.
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
 * Returns ChatGPT's data-message-id when available for a node.
 */
function getMessageId(el) {
    return el?.getAttribute?.('data-message-id') || null;
}

/**
 * Builds a stable message key using ChatGPT IDs or hashed content.
 */
function keyForMessage(el) {
    const domId = getMessageId(el);
    if (domId) return domId;
    const text = normalizeText(el.innerText).slice(0, 4000); // perf cap
    const idx = Array.prototype.indexOf.call(el.parentElement?.children || [], el);
    return hashString(text + "|" + idx);
}

/**
 * Determines whether a message should show the collapse button.
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
 * Reads values from chrome.storage.local for the given keys.
 */
async function getStore(keys) {
    if (!Array.isArray(keys) || !keys.length) return {};
    return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

/**
 * Persists values to chrome.storage.local.
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

/**
 * Marks a node as owned by the extension for mutation filtering.
 */
function markExtNode(el) {
    if (el?.setAttribute) {
        el.setAttribute(EXT_ATTR, '1');
    }
}

/**
 * Returns the nearest ancestor that belongs to the extension.
 */
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

/**
 * Checks whether a given DOM node is part of Tagalyst UI.
 */
function isExtensionNode(node) {
    return !!closestExtNode(node);
}

/**
 * Tells whether a mutation affects non-extension DOM nodes.
 */
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

/**
 * True when the Search pane is enabled in config.
 */
function isSearchEnabled() {
    return !!config.searchEnabled;
}

/**
 * True when the Tags pane is enabled in config.
 */
function areTagsEnabled() {
    return !!config.tagsEnabled;
}

/**
 * Requests a deferred refresh via the bootstrap orchestrator.
 */
function requestRefresh() {
    if (typeof bootstrap === 'function' && typeof bootstrap._requestRefresh === 'function') {
        bootstrap._requestRefresh();
    }
}

/**
 * Ensures transient focus state matches current feature toggles.
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
 * Applies a config override and re-syncs UI/focus state.
 */
function applyConfigObject(obj) {
    config = { ...defaultConfig, ...(obj || {}) };
    enforceConfigState();
    updateConfigUI();
    syncFocusMode();
    requestRefresh();
}

/**
 * Loads the config from storage (one time) before use.
 */
async function ensureConfigLoaded() {
    if (configLoaded) return config;
    const store = await getStore([CONFIG_STORAGE_KEY]);
    applyConfigObject(store[CONFIG_STORAGE_KEY]);
    configLoaded = true;
    return config;
}

/**
 * Shows/hides panels and disables inputs based on config flags.
 */
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
/**
 * Clears all focus-related state to its defaults.
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
 * Determines which focus mode (stars/tags/search) is active.
 */
function computeFocusMode() {
    if (isSearchEnabled() && focusState.searchQueryLower) return FOCUS_MODES.SEARCH;
    if (areTagsEnabled() && focusState.selectedTags.size) return FOCUS_MODES.TAGS;
    return FOCUS_MODES.STARS;
}

/**
 * Returns a human-friendly label for the current focus mode.
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
 * Returns the glyph representing focused/unfocused state for the mode.
 */
function getFocusGlyph(isFilled) {
    const glyph = focusGlyphs[focusState.mode] || focusGlyphs[FOCUS_MODES.STARS];
    return isFilled ? glyph.filled : glyph.empty;
}

/**
 * Ensures message metadata exists (key/value/pairIndex cache).
 */
function ensureMessageMeta(el, key) {
    let meta = messageState.get(el);
    if (!meta) {
        meta = { key: key || null, value: {}, pairIndex: null };
        messageState.set(el, meta);
    }
    if (key) meta.key = key;
    return meta;
}

/**
 * Updates cached metadata for a message element.
 */
function setMessageMeta(el, { key, value, pairIndex }) {
    const meta = ensureMessageMeta(el, key);
    if (typeof pairIndex === 'number') meta.pairIndex = pairIndex;
    if (value) meta.value = value;
    return meta;
}

/**
 * Whether a stored value contains any of the currently selected tags.
 */
function matchesSelectedTags(value) {
    if (!areTagsEnabled() || !focusState.selectedTags.size) return false;
    const tags = Array.isArray(value?.tags) ? value.tags : [];
    if (!tags.length) return false;
    return tags.some(tag => focusState.selectedTags.has(tag));
}

/**
 * True when the DOM node text matches the active search query.
 */
function matchesSearchQuery(el) {
    const query = focusState.searchQueryLower;
    if (!query) return false;
    const text = normalizeText(el?.innerText || '').toLowerCase();
    return text.includes(query);
}

/**
 * Determines if a message is part of the active focus set.
 */
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

/**
 * Syncs the per-message focus button glyph and aria state.
 */
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

/**
 * Updates buttons on all known message nodes.
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
 * Recomputes the focus mode and updates visual affordances.
 */
function syncFocusMode() {
    focusState.mode = computeFocusMode();
    focusNavIndex = -1;
    refreshFocusButtons();
    updateFocusControlsUI();
    syncTagSidebarSelectionUI();
}

/**
 * Collects DOM nodes currently belonging to the focus subset.
 */
function getFocusMatches() {
    const nodes = [];
    messageState.forEach(({ value }, el) => {
        if (document.contains(el) && isMessageFocused(el, value || {})) {
            nodes.push(el);
        }
    });
    return nodes;
}

/**
 * Returns a noun describing the current focus subset for tooltips.
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
 * Refreshes navigation/collapse/export button labels to match focus mode.
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
 * Updates the tag list UI to reflect selected tags.
 */
function syncTagSidebarSelectionUI() {
    if (!tagListEl) return;
    tagListEl.querySelectorAll('.ext-tag-sidebar-row').forEach(row => {
        const tag = row.dataset.tag;
        row.classList.toggle('ext-tag-selected', !!(tag && focusState.selectedTags.has(tag)));
    });
}

/**
 * Handles user input in the search panel and updates focus state.
 */
function handleSearchInput(value) {
    if (!isSearchEnabled()) return;
    const normalized = (value || '').trim();
    focusState.searchQuery = normalized;
    focusState.searchQueryLower = normalized.toLowerCase();
    syncFocusMode();
}

/**
 * Adds/removes a tag from the selected set then re-syncs focus.
 */
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

// Export selected helpers for unit tests without affecting extension runtime
if (typeof module !== 'undefined') {
    module.exports = {
        hashString,
        normalizeText,
    };
}
