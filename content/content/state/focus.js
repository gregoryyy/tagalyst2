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
const focusMarkerColors = {
    [FOCUS_MODES.STARS]: '#f2b400',
    [FOCUS_MODES.TAGS]: '#4aa0ff',
    [FOCUS_MODES.SEARCH]: '#a15bfd',
};
/**
 * Holds focus mode state derived from tags/search/stars and exposes helpers to evaluate matches.
 */
class FocusService {
    constructor(config) {
        this.config = config;
        this.mode = FOCUS_MODES.STARS;
        this.selectedTags = new Set();
        this.searchQuery = '';
        this.searchQueryLower = '';
        this.navIndex = -1;
    }
    /**
     * Resets focus mode and criteria to default stars-based navigation.
     */
    reset() {
        this.selectedTags.clear();
        this.searchQuery = '';
        this.searchQueryLower = '';
        this.mode = FOCUS_MODES.STARS;
        this.navIndex = -1;
    }
    /**
     * Updates the normalized search query.
     */
    setSearchQuery(raw) {
        const normalized = (raw || '').trim();
        this.searchQuery = normalized;
        this.searchQueryLower = normalized.toLowerCase();
    }
    /**
     * Toggles a tag selection on or off.
     */
    toggleTag(tag) {
        if (!tag)
            return;
        const wasSelected = this.selectedTags.has(tag);
        if (wasSelected) {
            this.selectedTags.delete(tag);
        }
        else {
            this.selectedTags.add(tag);
        }
    }
    /**
     * Clears all selected tags.
     */
    clearTags() {
        if (this.selectedTags.size) {
            this.selectedTags.clear();
        }
    }
    /**
     * Returns true when the tag is presently selected.
     */
    isTagSelected(tag) {
        return this.selectedTags.has(tag);
    }
    /**
     * Returns a copy of the selected tag list.
     */
    getTags() {
        return Array.from(this.selectedTags);
    }
    /**
     * Returns the raw search query.
     */
    getSearchQuery() {
        return this.searchQuery;
    }
    /**
     * Returns the current focus mode.
     */
    getMode() {
        return this.mode;
    }
    /**
     * Human friendly description of the active focus mode.
     */
    describeMode() {
        switch (this.mode) {
            case FOCUS_MODES.TAGS:
                return 'selected tags';
            case FOCUS_MODES.SEARCH:
                return 'search results';
            default:
                return 'starred items';
        }
    }
    /**
     * Returns a singular label for the current focus type (used by tooltips).
     */
    getModeLabel() {
        switch (this.mode) {
            case FOCUS_MODES.TAGS:
                return 'tagged message';
            case FOCUS_MODES.SEARCH:
                return 'search hit';
            default:
                return 'starred message';
        }
    }
    /**
     * Returns the UI glyph representing the focus mode.
     */
    getGlyph(isFilled) {
        const glyph = focusGlyphs[this.mode] || focusGlyphs[FOCUS_MODES.STARS];
        return isFilled ? glyph.filled : glyph.empty;
    }
    /**
     * Derives the current mode based on config + search/tags.
     */
    computeMode() {
        if (this.config.isSearchEnabled() && this.searchQueryLower)
            return FOCUS_MODES.SEARCH;
        if (this.config.areTagsEnabled() && this.selectedTags.size)
            return FOCUS_MODES.TAGS;
        return FOCUS_MODES.STARS;
    }
    /**
     * Recomputes the active mode and resets navigation index.
     */
    syncMode() {
        this.mode = this.computeMode();
        this.navIndex = -1;
    }
    /**
     * Determines if a given message matches the current focus criteria.
     */
    isMessageFocused(meta, el) {
        switch (this.mode) {
            case FOCUS_MODES.TAGS:
                return this.matchesSelectedTags(meta.value);
            case FOCUS_MODES.SEARCH:
                return this.matchesSearch(meta, el);
            default:
                return !!meta.value?.starred;
        }
    }
    /**
     * Enumerates message adapters that match focus state, sorted top-to-bottom.
     */
    getMatches(store) {
        const matches = [];
        store.forEach((meta, el) => {
            if (!document.contains(el)) {
                store.delete(el);
                return;
            }
            const adapter = meta.adapter || store.resolveAdapter(el);
            if (this.isMessageFocused(meta, el)) {
                matches.push(adapter);
            }
        });
        matches.sort((a, b) => {
            const aRect = a.element?.getBoundingClientRect();
            const bRect = b.element?.getBoundingClientRect();
            const aTop = aRect ? aRect.top + window.scrollY : 0;
            const bTop = bRect ? bRect.top + window.scrollY : 0;
            return aTop - bTop;
        });
        return matches;
    }
    /**
     * Advances the navigation index through the focused items.
     */
    adjustNav(delta, total) {
        if (total <= 0) {
            this.navIndex = -1;
            return this.navIndex;
        }
        if (this.navIndex < 0 || this.navIndex >= total) {
            this.navIndex = delta >= 0 ? 0 : total - 1;
        }
        else {
            this.navIndex = Math.max(0, Math.min(this.navIndex + delta, total - 1));
        }
        return this.navIndex;
    }
    /**
     * Checks whether the provided message contains any selected tags.
     */
    matchesSelectedTags(value) {
        if (!this.config.areTagsEnabled() || !this.selectedTags.size)
            return false;
        const tags = Array.isArray(value?.tags) ? value.tags : [];
        if (!tags.length)
            return false;
        return tags.some(tag => this.selectedTags.has(tag.toLowerCase()));
    }
    /**
     * Determines if search query matches message text, tags, or notes.
     */
    matchesSearch(meta, el) {
        if (!this.searchQueryLower)
            return false;
        const adapter = meta.adapter;
        const textSource = adapter ? adapter.getText() : Utils.normalizeText(el?.innerText || '');
        const text = textSource.toLowerCase();
        if (text.includes(this.searchQueryLower))
            return true;
        const tags = Array.isArray(meta.value?.tags) ? meta.value.tags : [];
        if (tags.some(tag => tag.toLowerCase().includes(this.searchQueryLower)))
            return true;
        const note = typeof meta.value?.note === 'string' ? meta.value.note.toLowerCase() : '';
        if (note && note.includes(this.searchQueryLower))
            return true;
        return false;
    }
} // FocusService
/**
 * Bridges FocusService state with UI controls/buttons on the page.
 */
class FocusController {
    constructor(focus, messages) {
        this.focus = focus;
        this.messages = messages;
        this.pageControls = null;
        this.selectionSync = null;
    }
    /**
     * Resets focus service and clears UI bindings.
     */
    reset() {
        this.focus.reset();
        this.pageControls = null;
        this.messages.clear();
    }
    /**
     * Registers a callback to keep selection overlays in sync with focus state.
     */
    attachSelectionSync(handler) {
        this.selectionSync = handler;
    }
    /**
     * Assigns the DOM controls used for page-level navigation.
     */
    setPageControls(controls) {
        this.pageControls = controls;
        this.updateControlsUI();
    }
    /**
     * Updates the toolbar focus button state for a message.
     */
    updateMessageButton(el, meta) {
        const btn = el.querySelector('.ext-toolbar .ext-focus-button');
        if (!btn)
            return;
        const active = this.focus.isMessageFocused(meta, el);
        const glyph = this.getGlyph(active);
        if (btn.textContent !== glyph)
            btn.textContent = glyph;
        const pressed = String(active);
        if (btn.getAttribute('aria-pressed') !== pressed) {
            btn.setAttribute('aria-pressed', pressed);
        }
        const focusDesc = this.describeMode();
        const interactive = this.focus.getMode() === FOCUS_MODES.STARS;
        const disabled = !interactive;
        if (btn.disabled !== disabled) {
            if (disabled) {
                btn.setAttribute('disabled', 'true');
            }
            else {
                btn.removeAttribute('disabled');
            }
        }
        if (interactive) {
            const title = active ? 'Remove bookmark' : 'Bookmark message';
            if (btn.title !== title) {
                btn.title = title;
                btn.setAttribute('aria-label', title);
            }
        }
        else {
            const title = active ? `Matches ${focusDesc}` : `Does not match ${focusDesc}`;
            if (btn.title !== title) {
                btn.title = title;
                btn.setAttribute('aria-label', title);
            }
        }
    }
    /**
     * Re-renders all message buttons to reflect the latest focus state.
     */
    refreshButtons() {
        this.messages.forEach((meta, el) => {
            if (!document.contains(el)) {
                this.messages.delete(el);
                return;
            }
            if (!meta.adapter) {
                meta.adapter = new DomMessageAdapter(el);
            }
            this.updateMessageButton(el, meta);
        });
        this.updateControlsUI();
    }
    /**
     * Re-synchronizes focus mode and refreshes UI + selection state.
     */
    syncMode() {
        this.focus.syncMode();
        this.refreshButtons();
        this.updateControlsUI();
        this.selectionSync?.();
    }
    /**
     * Returns the currently focused message adapters.
     */
    getMatches() {
        return this.focus.getMatches(this.messages);
    }
    /**
     * Returns the glyph for the active focus mode.
     */
    getGlyph(isFilled) {
        return this.focus.getGlyph(isFilled);
    }
    /**
     * Returns a human readable description for focus mode.
     */
    describeMode() {
        return this.focus.describeMode();
    }
    /**
     * Returns the singular label used for focus UI hints.
     */
    getModeLabel() {
        return this.focus.getModeLabel();
    }
    /**
     * Syncs page control button labels/titles with focus mode.
     */
    updateControlsUI() {
        if (!this.pageControls)
            return;
        const mode = this.focus.getMode();
        const glyph = focusGlyphs[mode] || focusGlyphs[FOCUS_MODES.STARS];
        const desc = this.getModeLabel();
        const starFallbackActive = mode === FOCUS_MODES.STARS && !this.hasStarredMessages();
        const navGlyph = starFallbackActive ? glyph.empty : glyph.filled;
        const navTitlePrev = starFallbackActive ? 'Previous message' : `Previous ${desc}`;
        const navTitleNext = starFallbackActive ? 'Next message' : `Next ${desc}`;
        if (this.pageControls.focusPrev) {
            this.pageControls.focusPrev.textContent = `${navGlyph}↑`;
            this.pageControls.focusPrev.title = navTitlePrev;
        }
        if (this.pageControls.focusNext) {
            this.pageControls.focusNext.textContent = `${navGlyph}↓`;
            this.pageControls.focusNext.title = navTitleNext;
        }
        if (this.pageControls.collapseNonFocus) {
            this.pageControls.collapseNonFocus.textContent = glyph.empty;
            this.pageControls.collapseNonFocus.title = `Collapse messages outside current ${desc}s`;
        }
        if (this.pageControls.expandFocus) {
            this.pageControls.expandFocus.textContent = `${glyph.filled}`;
            this.pageControls.expandFocus.title = `Expand current ${desc}s`;
        }
        if (this.pageControls.exportFocus) {
            this.pageControls.exportFocus.textContent = glyph.filled;
            this.pageControls.exportFocus.title = `Copy Markdown for current ${desc}s`;
        }
    }
    /**
     * Returns true when either element in the pair is focused.
     */
    isPairFocused(pair) {
        const nodes = [];
        if (pair.query)
            nodes.push(pair.query);
        if (pair.response)
            nodes.push(pair.response);
        return nodes.some(node => {
            if (!node)
                return false;
            const meta = this.messages.get(node);
            if (!meta)
                return false;
            return this.focus.isMessageFocused(meta, node);
        });
    }
    hasStarredMessages() {
        let found = false;
        this.messages.forEach((meta, el) => {
            if (found)
                return;
            if (!document.contains(el)) {
                this.messages.delete(el);
                return;
            }
            if (meta.value?.starred) {
                found = true;
            }
        });
        return found;
    }
} // FocusController
