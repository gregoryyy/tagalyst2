/// <reference path="./types/domain.d.ts" />
/// <reference path="./types/globals.d.ts" />
/// <reference path="./markdown.ts" />

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

type MessageMeta = {
    key: string | null;
    value: MessageValue;
    pairIndex: number | null;
    adapter: MessageAdapter | null;
};

/**
 * Tracks metadata for DOM message elements such as storage keys, values, and adapters.
 */
class MessageMetaRegistry {
    private readonly store = new Map<HTMLElement, MessageMeta>();

    /**
     * Clears all cached metadata entries.
     */
    clear() {
        this.store.clear();
    }

    /**
     * Retrieves the metadata record for a given element, if any.
     */
    get(el: HTMLElement) {
        return this.store.get(el) || null;
    }

    /**
     * Deletes the metadata record for a given element.
     */
    delete(el: HTMLElement) {
        this.store.delete(el);
    }

    /**
     * Iterates over all metadata entries.
     */
    forEach(cb: (meta: MessageMeta, el: HTMLElement) => void) {
        this.store.forEach(cb);
    }

    /**
     * Ensures a metadata record exists for the element and optionally seeds key/adapter.
     */
    ensure(el: HTMLElement, key?: string | null, adapter?: MessageAdapter | null) {
        let meta = this.store.get(el);
        if (!meta) {
            meta = { key: key || null, value: {}, pairIndex: null, adapter: adapter || null };
            this.store.set(el, meta);
        }
        if (key) meta.key = key;
        if (adapter) meta.adapter = adapter;
        return meta;
    }

    /**
     * Updates portions of a metadata record in place.
     */
    update(el: HTMLElement, opts: { key?: string | null; value?: MessageValue; pairIndex?: number | null; adapter?: MessageAdapter | null } = {}) {
        const meta = this.ensure(el, opts.key ?? null, opts.adapter ?? null);
        if (typeof opts.pairIndex === 'number') {
            meta.pairIndex = opts.pairIndex;
        } else if (opts.pairIndex === null) {
            meta.pairIndex = null;
        }
        if (opts.value) meta.value = opts.value;
        return meta;
    }

    /**
     * Resolves (or creates) a DomMessageAdapter for the element.
     */
    resolveAdapter(el: HTMLElement): MessageAdapter {
        const meta = this.ensure(el);
        if (meta.adapter && meta.adapter.element === el) {
            return meta.adapter;
        }
        const adapter = new DomMessageAdapter(el);
        meta.adapter = adapter;
        return adapter;
    }

    /**
     * Returns the internal metadata map. Consumers must handle stale nodes.
     */
    getStore() {
        return this.store;
    }
} // MessageMetaRegistry

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

const focusMarkerColors: Record<FocusMode, string> = {
    [FOCUS_MODES.STARS]: '#f2b400',
    [FOCUS_MODES.TAGS]: '#4aa0ff',
    [FOCUS_MODES.SEARCH]: '#a15bfd',
};

/**
 * Holds focus mode state derived from tags/search/stars and exposes helpers to evaluate matches.
 */
class FocusService {
    private mode: FocusMode = FOCUS_MODES.STARS;
    private readonly selectedTags = new Set<string>();
    private searchQuery = '';
    private searchQueryLower = '';
    private navIndex = -1;

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
    setSearchQuery(raw: string) {
        const normalized = (raw || '').trim();
        this.searchQuery = normalized;
        this.searchQueryLower = normalized.toLowerCase();
    }

    /**
     * Toggles a tag selection on or off.
     */
    toggleTag(tag: string) {
        if (!tag) return;
        const wasSelected = this.selectedTags.has(tag);
        if (wasSelected) {
            this.selectedTags.delete(tag);
        } else {
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
    isTagSelected(tag: string): boolean {
        return this.selectedTags.has(tag);
    }

    /**
     * Returns a copy of the selected tag list.
     */
    getTags(): string[] {
        return Array.from(this.selectedTags);
    }

    /**
     * Returns the raw search query.
     */
    getSearchQuery(): string {
        return this.searchQuery;
    }

    /**
     * Returns the current focus mode.
     */
    getMode(): FocusMode {
        return this.mode;
    }

    /**
     * Human friendly description of the active focus mode.
     */
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

    /**
     * Returns a singular label for the current focus type (used by tooltips).
     */
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

    /**
     * Returns the UI glyph representing the focus mode.
     */
    getGlyph(isFilled: boolean): string {
        const glyph = focusGlyphs[this.mode] || focusGlyphs[FOCUS_MODES.STARS];
        return isFilled ? glyph.filled : glyph.empty;
    }

    /**
     * Derives the current mode based on config + search/tags.
     */
    computeMode(): FocusMode {
        if (configService.isSearchEnabled() && this.searchQueryLower) return FOCUS_MODES.SEARCH;
        if (configService.areTagsEnabled() && this.selectedTags.size) return FOCUS_MODES.TAGS;
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

    /**
     * Enumerates message adapters that match focus state, sorted top-to-bottom.
     */
    getMatches(store: MessageMetaRegistry): MessageAdapter[] {
        const matches: MessageAdapter[] = [];
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

    /**
     * Checks whether the provided message contains any selected tags.
     */
    private matchesSelectedTags(value: MessageValue): boolean {
        if (!configService.areTagsEnabled() || !this.selectedTags.size) return false;
        const tags = Array.isArray(value?.tags) ? value.tags : [];
        if (!tags.length) return false;
        return tags.some(tag => this.selectedTags.has(tag.toLowerCase()));
    }

    /**
     * Determines if search query matches message text, tags, or notes.
     */
    private matchesSearch(meta: MessageMeta, el: HTMLElement): boolean {
        if (!this.searchQueryLower) return false;
        const adapter = meta.adapter;
        const textSource = adapter ? adapter.getText() : Utils.normalizeText(el?.innerText || '');
        const text = textSource.toLowerCase();
        if (text.includes(this.searchQueryLower)) return true;
        const tags = Array.isArray(meta.value?.tags) ? meta.value.tags : [];
        if (tags.some(tag => tag.toLowerCase().includes(this.searchQueryLower))) return true;
        const note = typeof meta.value?.note === 'string' ? meta.value.note.toLowerCase() : '';
        if (note && note.includes(this.searchQueryLower)) return true;
        return false;
    }
} // FocusService

const focusService = new FocusService();

/**
 * Bridges FocusService state with UI controls/buttons on the page.
 */
class FocusController {
    private pageControls: PageControls | null = null;
    private selectionSync: (() => void) | null = null;

    constructor(private readonly focus: FocusService, private readonly messages: MessageMetaRegistry) { }

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
    attachSelectionSync(handler: () => void) {
        this.selectionSync = handler;
    }

    /**
     * Assigns the DOM controls used for page-level navigation.
     */
    setPageControls(controls: PageControls | null) {
        this.pageControls = controls;
        this.updateControlsUI();
    }

    /**
     * Updates the toolbar focus button state for a message.
     */
    updateMessageButton(el: HTMLElement, meta: MessageMeta) {
        const btn = el.querySelector<HTMLButtonElement>('.ext-toolbar .ext-focus-button');
        if (!btn) return;
        const active = this.focus.isMessageFocused(meta, el);
        const glyph = this.getGlyph(active);
        if (btn.textContent !== glyph) btn.textContent = glyph;
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
    getMatches(): MessageAdapter[] {
        return this.focus.getMatches(this.messages);
    }

    /**
     * Returns the glyph for the active focus mode.
     */
    getGlyph(isFilled: boolean) {
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
        if (!this.pageControls) return;
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
    isPairFocused(pair: TagalystPair) {
        const nodes: HTMLElement[] = [];
        if (pair.query) nodes.push(pair.query);
        if (pair.response) nodes.push(pair.response);
        return nodes.some(node => {
            if (!node) return false;
            const meta = this.messages.get(node);
            if (!meta) return false;
            return this.focus.isMessageFocused(meta, node);
        });
    }

    private hasStarredMessages(): boolean {
        let found = false;
        this.messages.forEach((meta, el) => {
            if (found) return;
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

const focusController = new FocusController(focusService, messageMetaRegistry);

/**
 * Manages the floating search/tag control panel at the top of the page.
 */
class TopPanelController {
    private topPanelsEl: HTMLElement | null = null;
    private tagListEl: HTMLElement | null = null;
    private searchInputEl: HTMLInputElement | null = null;
    private lastTagSignature = '';
    private searchResultCountEl: HTMLElement | null = null;
    private frameState: Record<'search' | 'tags', { el: HTMLElement | null; timer: number | null }> = {
        search: { el: null, timer: null },
        tags: { el: null, timer: null },
    };

    /**
     * Ensures the panel DOM exists and returns the root element.
     */
    ensurePanels(): HTMLElement {
        if (this.topPanelsEl) return this.topPanelsEl;
        const wrap = document.createElement('div');
        wrap.id = 'ext-top-panels';
        wrap.innerHTML = `
            <div class="ext-top-frame ext-top-search">
                <span class="ext-top-label">Search</span>
                <input type="text" class="ext-search-input" placeholder="Search messages…" />
                <span class="ext-search-count" aria-live="polite"></span>
            </div>
            <div class="ext-top-frame ext-top-tags">
                <span class="ext-top-label">Tags</span>
                <div class="ext-tag-list" id="ext-tag-list"></div>
            </div>
        `;
        Utils.markExtNode(wrap);
        document.body.appendChild(wrap);
        this.topPanelsEl = wrap;
        this.tagListEl = wrap.querySelector<HTMLElement>('#ext-tag-list');
        this.searchInputEl = wrap.querySelector<HTMLInputElement>('.ext-search-input');
        this.searchResultCountEl = wrap.querySelector<HTMLElement>('.ext-search-count');
        this.frameState.search.el = wrap.querySelector<HTMLElement>('.ext-top-search');
        this.frameState.tags.el = wrap.querySelector<HTMLElement>('.ext-top-tags');
        this.bindFrameHover('search', this.frameState.search.el);
        this.bindFrameHover('tags', this.frameState.tags.el);
        if (this.searchInputEl) {
            this.searchInputEl.value = focusService.getSearchQuery();
            this.searchInputEl.addEventListener('input', (evt) => {
                const target = evt.target as HTMLInputElement;
                this.handleSearchInput(target.value);
            });
        }
        this.updateConfigUI();
        this.syncWidth();
        this.updateSearchResultCount();
        return wrap;
    }

    /**
     * Renders the tag list sidebar with counts.
     */
    updateTagList(counts: Array<{ tag: string; count: number }>) {
        this.ensurePanels();
        const tagsEnabled = configService.areTagsEnabled();
        const signature = this.computeTagSignature(counts, tagsEnabled);
        if (!this.tagListEl) {
            return;
        }
        if (signature === this.lastTagSignature) {
            // No structural change; keep existing DOM so clicks aren't disrupted.
            this.syncSelectionUI();
            return;
        }
        this.lastTagSignature = signature;
        this.tagListEl.innerHTML = '';
        this.tagListEl.classList.toggle('ext-tags-disabled', !tagsEnabled);
        if (!counts.length) {
            const empty = document.createElement('div');
            empty.className = 'ext-tag-sidebar-empty';
            empty.textContent = 'No tags yet';
            this.tagListEl.appendChild(empty);
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
            row.addEventListener('click', () => this.toggleTagSelection(tag, row));
            this.tagListEl.appendChild(row);
        }
        this.syncSelectionUI();
    }

    /**
     * Applies selection styles to each tag row.
     */
    syncSelectionUI() {
        if (!this.tagListEl) return;
        this.tagListEl.querySelectorAll<HTMLElement>('.ext-tag-sidebar-row').forEach(row => {
            const tag = row.dataset.tag;
            row.classList.toggle('ext-tag-selected', !!(tag && focusService.isTagSelected(tag)));
        });
    }

    /**
     * Binds hover/focus handlers that expand the panel when enabled.
     */
    private bindFrameHover(panel: 'search' | 'tags', frame: HTMLElement | null) {
        if (!frame) return;
        if (frame.dataset.hoverBound === '1') return;
        frame.dataset.hoverBound = '1';
        frame.addEventListener('mouseenter', () => this.handleFrameHover(panel, true));
        frame.addEventListener('mouseleave', () => this.handleFrameHover(panel, false));
        frame.addEventListener('focusin', () => this.handleFrameHover(panel, true));
        frame.addEventListener('focusout', () => this.handleFrameHover(panel, false));
    }

    /**
     * Expands/collapses a panel section when hovering or leaving.
     */
    private handleFrameHover(panel: 'search' | 'tags', entering: boolean) {
        if (!this.shouldExpand(panel)) return;
        const state = this.frameState[panel];
        const frame = state.el;
        if (!frame) return;
        if (entering) {
            frame.classList.add('ext-top-frame-wide');
            if (state.timer) {
                clearTimeout(state.timer);
                state.timer = null;
            }
        } else {
            if (state.timer) clearTimeout(state.timer);
            state.timer = window.setTimeout(() => {
                frame.classList.remove('ext-top-frame-wide');
                state.timer = null;
            }, 2000);
        }
    }

    /**
     * Returns true if the requested panel is allowed to expand on hover.
     */
    private shouldExpand(panel: 'search' | 'tags') {
        return panel === 'search'
            ? configService.doesSearchExpand()
            : configService.doTagsExpand();
    }

    /**
     * Applies expandable styling based on config flags.
     */
    private updateExpandState() {
        (['search', 'tags'] as const).forEach(panel => {
            const state = this.frameState[panel];
            const frame = state.el;
            if (!frame) return;
            const enabled = this.shouldExpand(panel);
            frame.classList.toggle('ext-top-frame-expandable', enabled);
            if (!enabled) {
                frame.classList.remove('ext-top-frame-wide');
                if (state.timer) {
                    clearTimeout(state.timer);
                    state.timer = null;
                }
            }
        });
    }

    /**
     * Produces a hash-like signature of the tag list used to skip redundant renders.
     */
    private computeTagSignature(counts: Array<{ tag: string; count: number }>, tagsEnabled: boolean) {
        const suffix = counts.map(({ tag, count }) => `${tag}:${count}`).join('|');
        return `${tagsEnabled ? '1' : '0'}|${suffix}`;
    }

    /**
     * Synchronizes the panel UI with current config settings.
     */
    updateConfigUI() {
        if (!this.topPanelsEl) return;
        const searchPanel = this.topPanelsEl.querySelector<HTMLElement>('.ext-top-search');
        const tagPanel = this.topPanelsEl.querySelector<HTMLElement>('.ext-top-tags');
        if (searchPanel) searchPanel.style.display = configService.isSearchEnabled() ? '' : 'none';
        if (tagPanel) tagPanel.style.display = configService.areTagsEnabled() ? '' : 'none';
        if (this.searchInputEl) {
            const enabled = configService.isSearchEnabled();
            this.searchInputEl.disabled = !enabled;
            this.searchInputEl.placeholder = enabled ? 'Search messages…' : 'Search disabled in Options';
            if (!enabled) this.searchInputEl.value = '';
        }
        if (this.tagListEl) {
            this.tagListEl.classList.toggle('ext-tags-disabled', !configService.areTagsEnabled());
        }
        this.updateSearchResultCount();
        this.updateExpandState();
    }

    /**
     * Clears the search input field.
     */
    clearSearchInput() {
        if (this.searchInputEl) this.searchInputEl.value = '';
    }

    /**
     * Aligns the panel width with the main toolbar to avoid jitter.
     */
    syncWidth() {
        if (!this.topPanelsEl) return;
        const controls = document.getElementById('ext-page-controls');
        const refWidth = controls ? controls.getBoundingClientRect().width : null;
        const width = refWidth && refWidth > 0 ? refWidth : 220;
        this.topPanelsEl.style.minWidth = `${Math.max(220, Math.round(width))}px`;
        this.topPanelsEl.style.width = 'auto';
    }

    /**
     * Tears down panel references and timers.
     */
    reset() {
        this.topPanelsEl = null;
        this.tagListEl = null;
        this.searchInputEl = null;
        this.lastTagSignature = '';
        this.searchResultCountEl = null;
        Object.values(this.frameState).forEach(state => {
            if (state.timer) {
                clearTimeout(state.timer);
                state.timer = null;
            }
            state.el = null;
        });
    }

    /**
     * Returns the current panel root element if mounted.
     */
    getElement(): HTMLElement | null {
        return this.topPanelsEl;
    }

    /**
     * Handles search input changes and notifies focus state.
     */
    private handleSearchInput(value: string) {
        if (!configService.isSearchEnabled()) return;
        focusService.setSearchQuery(value || '');
        focusController.syncMode();
        this.updateSearchResultCount();
    }

    /**
     * Displays search result counts or hides them when inactive.
     */
    updateSearchResultCount() {
        if (!this.searchResultCountEl) return;
        if (!configService.isSearchEnabled()) {
            this.searchResultCountEl.textContent = '';
            return;
        }
        const query = focusService.getSearchQuery();
        if (!query) {
            this.searchResultCountEl.textContent = '';
            return;
        }
        const count = focusController.getMatches().length;
        this.searchResultCountEl.textContent = count === 1 ? '1 result' : `${count} results`;
    }

    /**
     * Handles clicking a tag row to toggle it within focus state.
     */
    private toggleTagSelection(tag: string, row?: HTMLElement) {
        if (!configService.areTagsEnabled()) {
            return;
        }
        const willSelect = !focusService.isTagSelected(tag);
        focusService.toggleTag(tag);
        if (row) {
            row.classList.toggle('ext-tag-selected', willSelect);
        }
        focusController.syncMode();
    }
} // TopPanelController

const topPanelController = new TopPanelController();

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
class OverviewRulerController {
    private messageMarkerLayer: HTMLElement | null = null;
    private messageMarkerPool: HTMLElement[] = [];
    private messageMarkerData: MarkerDatum[] = [];
    private highlightMarkerLayer: HTMLElement | null = null;
    private highlightMarkerPool: HTMLElement[] = [];
    private highlightMarkerData: MarkerDatum[] = [];
    private focusMarkerLayer: HTMLElement | null = null;
    private focusMarkerPool: HTMLElement[] = [];
    private starMarkerData: MarkerDatum[] = [];
    private tagMarkerData: MarkerDatum[] = [];
    private searchMarkerData: MarkerDatum[] = [];
    private root: HTMLElement | null = null;
    private trackEl: HTMLElement | null = null;
    private container: HTMLElement | null = null;
    private rafPending = false;
    private topAnchor: HTMLElement | null = null;
    private bottomAnchor: HTMLElement | null = null;
    private lastMessageAnchor: HTMLElement | null = null;
    private viewportEl: HTMLElement | null = null;
    private lastAdapters: MessageAdapter[] = [];
    private rulerCanExpand = true;
    private readonly handleMarkerClick = (evt: MouseEvent) => {
        const target = evt.currentTarget as HTMLElement | null;
        if (!target) return;
        const value = Number(target.dataset.docCenter);
        if (!Number.isFinite(value)) return;
        const viewport = this.getViewportHeight();
        const top = Math.max(0, value - viewport / 2);
        this.scrollContainerTo(top, 'smooth');
    };
    private pendingLayoutFrame: number | null = null;
    private pendingEntries: OverviewEntry[] | null = null;
    private pendingContainer: HTMLElement | null = null;
    private scrollContainer: HTMLElement | null = null;
    private trackHandlersBound = false;
    private trackDragActive = false;
    private suppressNextClick = false;
    private scrollEventTarget: EventTarget | null = null;
    private readonly handleTrackClick = (evt: MouseEvent) => this.onTrackClick(evt);
    private readonly handleTrackMouseDown = (evt: MouseEvent) => this.onTrackMouseDown(evt);
    private readonly handleTrackMouseMove = (evt: MouseEvent) => this.onTrackMouseMove(evt);
    private readonly handleTrackMouseUp = () => this.endTrackDrag();
    private readonly handleTrackWheel = (evt: WheelEvent) => this.onTrackWheel(evt);

    private readonly handleViewportChange = () => {
        if (!this.container) return;
        if (this.rafPending) return;
        this.rafPending = true;
        requestAnimationFrame(() => {
            this.rafPending = false;
            if (this.container) this.updatePosition(this.container);
        });
    };

    /**
     * Ensures the overview ruler DOM exists and attaches to the container.
     */
    ensure(container: HTMLElement) {
        if (this.root) {
            this.container = container;
            this.attachScrollContainer(container);
            this.updatePosition(container);
            this.applyExpandState();
            this.bindTrackHandlers();
            return this.root;
        }
        const root = document.createElement('div');
        root.id = 'ext-overview-ruler';
        const track = document.createElement('div');
        track.className = 'ext-overview-ruler-track';
        const messageLayer = document.createElement('div');
        messageLayer.className = 'ext-overview-marker-layer ext-overview-marker-layer--messages';
        const highlightLayer = document.createElement('div');
        highlightLayer.className = 'ext-overview-marker-layer ext-overview-marker-layer--highlights';
        const focusLayer = document.createElement('div');
        focusLayer.className = 'ext-overview-marker-layer ext-overview-marker-layer--focus';
        const viewport = document.createElement('div');
        viewport.className = 'ext-ruler-viewport';
        track.appendChild(messageLayer);
        track.appendChild(highlightLayer);
        track.appendChild(focusLayer);
        track.appendChild(viewport);
        root.appendChild(track);
        Utils.markExtNode(root);
        document.body.appendChild(root);
        this.root = root;
        this.trackEl = track;
        this.messageMarkerLayer = messageLayer;
        this.highlightMarkerLayer = highlightLayer;
        this.focusMarkerLayer = focusLayer;
        this.viewportEl = viewport;
        this.container = container;
        this.attachScrollContainer(container);
        window.addEventListener('resize', this.handleViewportChange);
        this.applyExpandState();
        this.bindTrackHandlers();
        this.updatePosition(container);
        return root;
    }

    /**
     * Schedules an update of marker data for the provided message entries.
     */
    update(container: HTMLElement, entries: OverviewEntry[]) {
        if (!entries.length) return;
        this.ensure(container);
        if (!this.root) return;
        this.pendingContainer = container;
        this.pendingEntries = entries;
        this.requestDeferredLayout();
    }

    private requestDeferredLayout() {
        if (this.pendingLayoutFrame !== null) return;
        const runSecondFrame = () => {
            this.pendingLayoutFrame = null;
            this.flushPendingUpdate();
        };
        const runFirstFrame = () => {
            this.pendingLayoutFrame = requestAnimationFrame(runSecondFrame);
        };
        this.pendingLayoutFrame = requestAnimationFrame(runFirstFrame);
    }

    private flushPendingUpdate() {
        const container = this.pendingContainer;
        const entries = this.pendingEntries;
        this.pendingEntries = null;
        if (!container || !entries?.length) return;
        this.performUpdate(container, entries);
    }

    private performUpdate(container: HTMLElement, entries: OverviewEntry[]) {
        if (!this.trackEl || !this.root) return;
        this.container = container;
        this.lastAdapters = entries.map(entry => entry.adapter);
        this.topAnchor = entries[0]?.adapter.element || null;
        this.lastMessageAnchor = entries[entries.length - 1]?.adapter.element || null;
        this.bottomAnchor = this.resolveComposerAnchor(container);
        const bounds = this.computeBounds(container);
        const scrollRange = this.computeScrollRange(container);
        this.messageMarkerData = this.collectMessageMarkerData(entries);
        this.collectSpecialMarkerData();
        this.applyFrame(container, bounds);
        if (!this.viewportEl || !this.viewportEl.isConnected) {
            this.viewportEl = document.createElement('div');
            this.viewportEl.className = 'ext-ruler-viewport';
            this.trackEl.appendChild(this.viewportEl);
        }
        this.updateViewportIndicator(scrollRange);
        this.layoutAllMarkers(scrollRange);
    }

    /**
     * Re-evaluates highlight/focus markers without re-running full layout.
     */
    refreshMarkers() {
        if (!this.container || !configService.isOverviewEnabled()) return;
        const scrollRange = this.computeScrollRange(this.container);
        this.collectSpecialMarkerData();
        this.layoutSpecialMarkers(scrollRange);
    }

    /**
     * Removes the overview ruler and clears pooled DOM nodes.
     */
    reset() {
        if (this.trackHandlersBound && this.root) {
            this.root.removeEventListener('click', this.handleTrackClick);
            this.root.removeEventListener('mousedown', this.handleTrackMouseDown);
            this.root.removeEventListener('wheel', this.handleTrackWheel);
            this.trackHandlersBound = false;
        }
        if (this.root?.parentElement) {
            this.root.parentElement.removeChild(this.root);
        }
        this.root = null;
        this.trackEl = null;
        this.container = null;
        this.topAnchor = null;
        this.bottomAnchor = null;
        this.lastMessageAnchor = null;
        this.viewportEl = null;
        this.messageMarkerLayer = null;
        this.messageMarkerPool = [];
        this.messageMarkerData = [];
        this.highlightMarkerLayer = null;
        this.highlightMarkerPool = [];
        this.highlightMarkerData = [];
        this.focusMarkerLayer = null;
        this.focusMarkerPool = [];
        this.starMarkerData = [];
        this.tagMarkerData = [];
        this.searchMarkerData = [];
        window.removeEventListener('resize', this.handleViewportChange);
        if (this.scrollEventTarget) {
            (this.scrollEventTarget as any).removeEventListener('scroll', this.handleViewportChange);
            this.scrollEventTarget = null;
        }
        this.scrollContainer = null;
        this.endTrackDrag(true);
        this.rulerCanExpand = true;
        if (this.pendingLayoutFrame !== null) {
            cancelAnimationFrame(this.pendingLayoutFrame);
            this.pendingLayoutFrame = null;
        }
        this.pendingEntries = null;
        this.pendingContainer = null;
    }

    /**
     * Enables or disables hover expansion support for the ruler UI.
     */
    setExpandable(enabled: boolean) {
        this.rulerCanExpand = enabled;
        this.applyExpandState();
    }

    private applyExpandState() {
        if (this.root) {
            this.root.classList.toggle('ext-overview-expandable', this.rulerCanExpand);
        }
    }

    private updatePosition(container: HTMLElement) {
        const bounds = this.computeBounds(container);
        const scrollRange = this.computeScrollRange(container);
        this.applyFrame(container, bounds);
        this.updateViewportIndicator(scrollRange);
        this.layoutAllMarkers(scrollRange);
    }

    private applyFrame(container: HTMLElement, bounds: { top: number; bottom: number }) {
        if (!this.root) return;
        const rect = container.getBoundingClientRect();
        const docTop = window.scrollY + bounds.top;
        const docLeft = window.scrollX + rect.left;
        this.root.style.top = `${docTop}px`;
        this.root.style.left = `${docLeft + 8}px`;
        const height = Math.max(1, bounds.bottom - bounds.top);
        this.root.style.height = `${height}px`;
    }

    private updateViewportIndicator(scrollRange: { top: number; bottom: number }) {
        if (!this.viewportEl) return;
        const scrollHeight = Math.max(1, scrollRange.bottom - scrollRange.top);
        const viewportTop = this.getScrollOffset();
        const viewportBottom = viewportTop + this.getViewportHeight();
        const intersectionTop = Math.max(viewportTop, scrollRange.top);
        const intersectionBottom = Math.min(viewportBottom, scrollRange.bottom);
        const visibleSpan = Math.max(0, intersectionBottom - intersectionTop);
        if (visibleSpan <= 0 || scrollHeight <= 1 || visibleSpan >= scrollHeight - 0.5) {
            this.viewportEl.style.display = 'none';
            return;
        }
        this.viewportEl.style.display = 'block';
        const topRatio = (intersectionTop - scrollRange.top) / scrollHeight;
        const heightRatio = Math.min(1, visibleSpan / scrollHeight);
        this.viewportEl.style.top = `${topRatio * 100}%`;
        this.viewportEl.style.height = `${heightRatio * 100}%`;
    }

    private layoutAllMarkers(scrollRange: { top: number; bottom: number }) {
        this.layoutMessageMarkers(scrollRange);
        this.layoutHighlightMarkers(scrollRange);
        this.layoutSpecialMarkers(scrollRange);
    }

    private layoutHighlightMarkers(scrollRange: { top: number; bottom: number }) {
        this.layoutMarkerSet({
            layer: this.highlightMarkerLayer,
            pool: this.highlightMarkerPool,
            data: this.highlightMarkerData,
            scrollRange,
            className: 'ext-overview-marker ext-overview-marker--highlight'
        });
    }

    private collectMessageMarkerData(entries: OverviewEntry[]): MarkerDatum[] {
        const seenPairs = new Set<number>();
        let fallbackIndex = 0;
        const candidates: Array<{ docCenter: number; visualCenter: number; labelValue: number }> = [];
        for (const { adapter, pairIndex } of entries) {
            const el = adapter?.element;
            if (!el || !document.contains(el)) continue;
            if (typeof pairIndex === 'number') {
                if (seenPairs.has(pairIndex)) continue;
                seenPairs.add(pairIndex);
            }
            const { docCenter, visualCenter } = this.resolveMarkerPositions(adapter);
            const anchor = Number.isFinite(docCenter ?? NaN)
                ? docCenter
                : Number.isFinite(visualCenter ?? NaN)
                    ? visualCenter
                    : null;
            if (!Number.isFinite(anchor ?? NaN)) continue;
            const labelValue = typeof pairIndex === 'number' ? pairIndex + 1 : ++fallbackIndex;
            candidates.push({
                docCenter: anchor!,
                visualCenter: anchor!,
                labelValue
            });
        }
        const total = candidates.length;
        let step = 1;
        if (total < 30) {
            step = 1;
        } else if (total < 60) {
            step = 5;
        } else if (total < 120) {
            step = 10;
        } else if (total < 200) {
            step = 20;
        } else {
            step = 20;
        }
        return candidates.map(({ docCenter, visualCenter, labelValue }) => {
            const label = step === 1 || labelValue % step === 0 ? String(labelValue) : null;
            return { docCenter, visualCenter, label, kind: 'message' };
        });
    }

    private collectSpecialMarkerData(adapters: MessageAdapter[] = this.lastAdapters) {
        const starData: MarkerDatum[] = [];
        const tagData: MarkerDatum[] = [];
        const searchData: MarkerDatum[] = [];
        if (!adapters || !adapters.length) {
            this.starMarkerData = starData;
            this.tagMarkerData = tagData;
            this.searchMarkerData = searchData;
            this.highlightMarkerData = [];
            return;
        }
        const query = (focusService.getSearchQuery() || '').toLowerCase();
        const selectedTags = focusService.getTags();
        const selectedTagSet = new Set(selectedTags.map(tag => tag.toLowerCase()));
        const filterToSelectedTags = selectedTagSet.size > 0;
        const store = messageMetaRegistry.getStore();
        for (const adapter of adapters) {
            const el = adapter.element;
            if (!el || !document.contains(el)) continue;
            const { docCenter, visualCenter } = this.resolveMarkerPositions(adapter);
            const anchor = Number.isFinite(docCenter ?? NaN)
                ? docCenter
                : Number.isFinite(visualCenter ?? NaN)
                    ? visualCenter
                    : null;
            if (!Number.isFinite(anchor ?? NaN)) continue;
            const visual = anchor!;
            const meta = store.get(el);
            const tags = Array.isArray(meta?.value?.tags) ? meta.value.tags : [];
            const normalizedTags = tags.map(tag => tag.toLowerCase());
            if (meta?.value?.starred) {
                starData.push({ docCenter: anchor!, visualCenter: visual, kind: 'star' });
            }
            if (filterToSelectedTags && normalizedTags.some(tag => selectedTagSet.has(tag))) {
                tagData.push({ docCenter: anchor!, visualCenter: visual, kind: 'tag' });
            }
            if (query) {
                const adapterText = (typeof (adapter as any).getText === 'function'
                    ? (adapter as any).getText()
                    : el.innerText || '').toLowerCase();
                const note = typeof meta?.value?.note === 'string' ? meta.value.note.toLowerCase() : '';
                const hasTagMatch = normalizedTags.some(tag => tag.includes(query));
                if (adapterText.includes(query) || note.includes(query) || hasTagMatch) {
                    searchData.push({ docCenter: anchor!, visualCenter: visual, kind: 'search' });
                }
            }
        }
        this.starMarkerData = starData;
        this.tagMarkerData = tagData;
        this.searchMarkerData = searchData;
        const threadKey = Utils.getThreadKey();
        this.highlightMarkerData = highlightController.getOverviewMarkers(adapters, threadKey);
    }

    private layoutMessageMarkers(scrollRange: { top: number; bottom: number }) {
        this.layoutMarkerSet({
            layer: this.messageMarkerLayer,
            pool: this.messageMarkerPool,
            data: this.messageMarkerData,
            scrollRange,
            className: 'ext-overview-marker ext-overview-marker--message'
        });
    }

    private layoutSpecialMarkers(scrollRange: { top: number; bottom: number }) {
        const combined = [
            ...this.starMarkerData,
            ...this.tagMarkerData,
            ...this.searchMarkerData
        ];
        this.layoutMarkerSet({
            layer: this.focusMarkerLayer,
            pool: this.focusMarkerPool,
            data: combined,
            scrollRange,
            className: 'ext-overview-marker ext-overview-marker--focus'
        });
    }

    private layoutMarkerSet(opts: {
        layer: HTMLElement | null;
        pool: HTMLElement[];
        data: MarkerDatum[];
        scrollRange: { top: number; bottom: number };
        className: string;
        color?: string;
        formatter?: (marker: HTMLElement, datum: MarkerDatum) => void;
    }) {
        const { layer, pool, data, scrollRange, className, color, formatter } = opts;
        if (!layer) return;
        const scrollHeight = scrollRange.bottom - scrollRange.top;
        if (!data.length || scrollHeight <= 0) {
            layer.style.display = 'none';
            for (const marker of pool) marker.style.display = 'none';
            return;
        }
        layer.style.display = 'block';
        if (color) {
            layer.style.setProperty('--marker-color', color);
        }
        for (let i = 0; i < data.length; i++) {
            const marker = this.ensureMarker(layer, pool, className, i);
            const datum = data[i];
            const ratio = Math.min(1, Math.max(0, (datum.docCenter - scrollRange.top) / scrollHeight));
            const visualAnchor = typeof datum.visualCenter === 'number' ? datum.visualCenter : datum.docCenter;
            const visualRatio = Math.min(1, Math.max(0, (visualAnchor - scrollRange.top) / scrollHeight));
            marker.style.top = `${visualRatio * 100}%`;
            if (typeof datum.docCenter === 'number' && Number.isFinite(datum.docCenter)) {
                marker.dataset.docCenter = String(datum.docCenter);
            } else {
                delete marker.dataset.docCenter;
            }
            marker.style.display = 'block';
            if (datum.kind) {
                marker.dataset.kind = datum.kind;
            } else {
                delete marker.dataset.kind;
            }
            if (datum.kind === 'highlight') {
                if (datum.label === 'annotated') {
                    marker.dataset.annotated = 'true';
                } else {
                    delete marker.dataset.annotated;
                }
            } else {
                delete marker.dataset.annotated;
            }
            if (datum.label) {
                marker.dataset.label = datum.label;
            } else {
                delete marker.dataset.label;
            }
            if (formatter) formatter(marker, datum);
        }
        for (let i = data.length; i < pool.length; i++) {
            pool[i].style.display = 'none';
        }
    }

    private ensureMarker(layer: HTMLElement, pool: HTMLElement[], className: string, index: number): HTMLElement {
        while (pool.length <= index) {
            const marker = document.createElement('div');
            marker.className = className;
            marker.addEventListener('click', this.handleMarkerClick);
            layer.appendChild(marker);
            pool.push(marker);
        }
        return pool[index];
    }

    private getMarkerColor(): string {
        const mode = focusService.getMode();
        return focusMarkerColors[mode] || focusMarkerColors[FOCUS_MODES.STARS];
    }

    private resolveMarkerPositions(adapter: MessageAdapter | null): { docCenter: number | null; visualCenter: number | null } {
        const el = adapter?.element;
        if (!el || !document.contains(el)) return { docCenter: null, visualCenter: null };
        const messageRect = el.getBoundingClientRect();
        const messageCenter = this.measureScrollSpaceCenter(messageRect);
        const toolbar =
            el.querySelector<HTMLElement>('.ext-toolbar-row') ||
            el.querySelector<HTMLElement>('.ext-toolbar');
        let docCenter = messageCenter;
        if (toolbar) {
            const toolbarRect = toolbar.getBoundingClientRect();
            if (toolbarRect) {
                docCenter = this.measureScrollSpaceCenter(toolbarRect);
            }
        }
        return {
            docCenter,
            visualCenter: messageCenter,
        };
    }

    /**
     * Converts a DOMRect into a document-space center value used by markers.
     */
    measureScrollSpaceCenter(rect: DOMRect | null): number | null {
        if (!rect) return null;
        const scrollOffset = this.getScrollOffset();
        const originOffset = this.getViewportOriginOffset();
        const height = rect.height || 0;
        return scrollOffset + (rect.top - originOffset) + height / 2;
    }

    private attachScrollContainer(container: HTMLElement) {
        const candidate = this.findScrollContainer(container);
        const target: EventTarget = candidate ?? window;
        if (this.scrollEventTarget !== target) {
            if (this.scrollEventTarget) {
                (this.scrollEventTarget as any).removeEventListener('scroll', this.handleViewportChange);
            }
            (target as any).addEventListener('scroll', this.handleViewportChange, { passive: true });
            this.scrollEventTarget = target;
        }
        this.scrollContainer = candidate;
    }

    private findScrollContainer(container: HTMLElement): HTMLElement | null {
        const dedicated = this.locateTranscriptScroller(container);
        if (dedicated) return dedicated;
        let current: HTMLElement | null = container;
        while (current) {
            const parent = current.parentElement as HTMLElement | null;
            if (this.isScrollable(current)) return current;
            current = parent;
        }
        const main = container.closest<HTMLElement>('main');
        if (this.isScrollable(main)) return main;
        const docScroll = document.scrollingElement as HTMLElement | null;
        if (this.isScrollable(docScroll)) return docScroll;
        return null;
    }

    private locateTranscriptScroller(container: HTMLElement): HTMLElement | null {
        if (!container) return null;
        const directParent = container.parentElement as HTMLElement | null;
        if (this.isScrollable(directParent)) return directParent;
        const scope = container.closest('main') || document.body;
        const selectors = [
            'div.flex.h-full.flex-col.overflow-y-auto',
            'div.flex.flex-col.overflow-y-auto',
            '[data-testid="conversation-main"] div.overflow-y-auto'
        ];
        for (const selector of selectors) {
            const candidate = scope.querySelector<HTMLElement>(selector);
            if (this.isScrollable(candidate)) return candidate;
        }
        return null;
    }

    private isScrollable(el: HTMLElement | null | undefined): el is HTMLElement {
        if (!el) return false;
        if (el === document.scrollingElement || el === document.documentElement || el === document.body) {
            return true;
        }
        const scrollableHeight = el.scrollHeight - el.clientHeight;
        if (scrollableHeight > 8) return true;
        const overflowY = getComputedStyle(el).overflowY;
        return overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
    }

    private getScrollOffset() {
        return this.scrollContainer ? this.scrollContainer.scrollTop : window.scrollY;
    }

    private getViewportHeight() {
        return this.scrollContainer ? this.scrollContainer.clientHeight : window.innerHeight;
    }

    private getViewportOriginOffset() {
        if (!this.scrollContainer) return 0;
        return this.scrollContainer.getBoundingClientRect().top;
    }

    private scrollContainerTo(top: number, behavior: ScrollBehavior) {
        if (this.scrollContainer) {
            this.scrollContainer.scrollTo({ top, behavior });
        } else {
            window.scrollTo({ top, behavior });
        }
        this.handleViewportChange();
    }

    private scrollContainerBy(delta: number) {
        if (this.scrollContainer) {
            this.scrollContainer.scrollBy({ top: delta, behavior: 'auto' });
        } else {
            window.scrollBy({ top: delta, behavior: 'auto' });
        }
        this.handleViewportChange();
    }

    private bindTrackHandlers() {
        if (this.trackHandlersBound || !this.root) return;
        this.root.addEventListener('click', this.handleTrackClick);
        this.root.addEventListener('mousedown', this.handleTrackMouseDown);
        this.root.addEventListener('wheel', this.handleTrackWheel, { passive: false });
        this.trackHandlersBound = true;
    }

    private onTrackClick(evt: MouseEvent) {
        if (!this.container || !this.root) return;
        if (this.suppressNextClick) {
            this.suppressNextClick = false;
            return;
        }
        const ratio = this.computeTrackRatio(evt);
        if (ratio === null) return;
        this.scrollToRatio(ratio);
    }

    private onTrackMouseDown(evt: MouseEvent) {
        if (evt.button !== 0) return;
        if (!this.container) return;
        evt.preventDefault();
        evt.stopPropagation();
        this.trackDragActive = true;
        this.suppressNextClick = false;
        document.addEventListener('mousemove', this.handleTrackMouseMove, true);
        document.addEventListener('mouseup', this.handleTrackMouseUp, true);
    }

    private onTrackMouseMove(evt: MouseEvent) {
        if (!this.trackDragActive) return;
        const ratio = this.computeTrackRatio(evt);
        if (ratio === null) return;
        this.suppressNextClick = true;
        this.scrollToRatio(ratio, 'auto');
    }

    private endTrackDrag(force = false) {
        if (!this.trackDragActive && !force) return;
        if (this.trackDragActive) {
        }
        this.trackDragActive = false;
        document.removeEventListener('mousemove', this.handleTrackMouseMove, true);
        document.removeEventListener('mouseup', this.handleTrackMouseUp, true);
    }

    private onTrackWheel(evt: WheelEvent) {
        if (!this.container) return;
        evt.preventDefault();
        evt.stopPropagation();
        const multiplier = evt.deltaMode === 2
            ? window.innerHeight
            : evt.deltaMode === 1
                ? 16
                : 1;
        const delta = evt.deltaY * multiplier;
        this.scrollContainerBy(delta);
    }

    private computeTrackRatio(evt: MouseEvent): number | null {
        const trackRect = this.root?.getBoundingClientRect();
        if (!trackRect || !trackRect.height) return null;
        const ratio = (evt.clientY - trackRect.top) / trackRect.height;
        return Math.min(1, Math.max(0, ratio));
    }

    private scrollToRatio(ratio: number, behavior: ScrollBehavior = 'smooth') {
        if (!this.container) return;
        const scrollRange = this.computeScrollRange(this.container);
        const viewport = this.getViewportHeight();
        const minTop = scrollRange.top;
        const maxTop = Math.max(scrollRange.top, scrollRange.bottom - viewport);
        const span = Math.max(0, maxTop - minTop);
        const target = minTop + span * ratio;
        this.scrollContainerTo(target, behavior);
    }

    private computeBounds(container: HTMLElement) {
        const rect = container.getBoundingClientRect();
        let topBound = rect.top;
        const headerRect = this.getHeaderRect(container);
        const topAnchorRect = this.getTopAnchorRect(container);
        if (headerRect) {
            topBound = Math.max(topBound, headerRect.bottom + 4);
        } else if (topAnchorRect) {
            topBound = Math.max(topBound, topAnchorRect.top);
        }

        let bottomBound = rect.bottom;
        const bottomRect = this.getBottomAnchorRect(container);
        const lastMessageRect = this.getLastMessageRect();
        if (bottomRect) {
            bottomBound = bottomRect.bottom;
        } else if (lastMessageRect) {
            bottomBound = lastMessageRect.bottom;
        }
        if (bottomBound <= topBound) {
            bottomBound = topBound + 24;
        }
        return { top: topBound, bottom: bottomBound };
    }

    private getHeaderRect(container: HTMLElement): DOMRect | null {
        const attrHeader = container.querySelector<HTMLElement>('[data-testid="conversation-header"]');
        if (attrHeader) return attrHeader.getBoundingClientRect();
        const directChildren = Array.from(container.children) as HTMLElement[];
        for (const child of directChildren) {
            const tag = child.tagName.toLowerCase();
            if (tag === 'header' || tag === 'h1' || tag === 'h2') {
                return child.getBoundingClientRect();
            }
            const nestedHeader = child.querySelector<HTMLElement>('header');
            if (nestedHeader) {
                return nestedHeader.getBoundingClientRect();
            }
        }
        return null;
    }

    private getTopAnchorRect(container: HTMLElement): DOMRect | null {
        if (this.topAnchor && document.contains(this.topAnchor)) {
            return this.topAnchor.getBoundingClientRect();
        }
        const firstMessage = container.querySelector<HTMLElement>('[data-message-author-role]');
        return firstMessage ? firstMessage.getBoundingClientRect() : null;
    }

    private getBottomAnchorRect(container: HTMLElement): DOMRect | null {
        const anchor = this.getComposerAnchor(container);
        return anchor ? anchor.getBoundingClientRect() : null;
    }

    private getComposerAnchor(container: HTMLElement): HTMLElement | null {
        if (this.bottomAnchor && document.contains(this.bottomAnchor)) {
            return this.bottomAnchor;
        }
        const resolved = this.resolveComposerAnchor(container);
        if (resolved) this.bottomAnchor = resolved;
        return resolved;
    }

    private getLastMessageRect(): DOMRect | null {
        if (this.lastMessageAnchor && document.contains(this.lastMessageAnchor)) {
            return this.lastMessageAnchor.getBoundingClientRect();
        }
        return null;
    }

    private resolveComposerAnchor(container: HTMLElement): HTMLElement | null {
        const scope = container.closest('main') || document.body;
        const selectors = [
            '[data-testid="composer"]',
            'textarea[data-id="prompt-textarea"]',
            'form textarea'
        ];
        for (const selector of selectors) {
            const node = scope.querySelector<HTMLElement>(selector) || document.querySelector<HTMLElement>(selector);
            if (node) {
                return node.closest('form') || node;
            }
        }
        return null;
    }

    private computeScrollRange(container: HTMLElement) {
        const containerRect = container.getBoundingClientRect();
        const headerRect = this.getHeaderRect(container);
        const topMessageRect = this.getTopAnchorRect(container);
        const bottomAnchorRect = this.getBottomAnchorRect(container);
        const lastMessageRect = this.getLastMessageRect();
        const scrollTop = this.getScrollOffset();
        const viewportOffset = this.getViewportOriginOffset();
        let top: number;
        if (topMessageRect) {
            top = scrollTop + (topMessageRect.top - viewportOffset);
        } else if (headerRect) {
            top = scrollTop + (headerRect.bottom - viewportOffset) + 4;
        } else {
            top = scrollTop + (containerRect.top - viewportOffset);
        }
        const bottomSource = lastMessageRect || bottomAnchorRect || containerRect;
        let bottom = scrollTop + (bottomSource.bottom - viewportOffset);
        if (bottom <= top) {
            bottom = top + 1;
        }
        return {
            top,
            bottom
        };
    }

    private pickLowerRect(rects: Array<DOMRect | null>): DOMRect {
        let chosen: DOMRect | null = null;
        for (const rect of rects) {
            if (!rect) continue;
            if (!chosen || rect.bottom > chosen.bottom) {
                chosen = rect;
            }
        }
        return chosen ?? new DOMRect(0, 0, 0, 0);
    }
}

const overviewRulerController = new OverviewRulerController();
focusController.attachSelectionSync(() => {
    topPanelController.syncSelectionUI();
    topPanelController.updateSearchResultCount();
    if (configService.isOverviewEnabled()) {
        overviewRulerController.refreshMarkers();
    }
});
configService.onChange(cfg => {
    topPanelController.updateConfigUI();
    overviewRulerController.setExpandable(!!cfg.overviewExpands);
    if (!cfg.overviewEnabled) {
        overviewRulerController.reset();
    } else {
        overviewRulerController.refreshMarkers();
    }
});

/**
 * Manages floating editors for tags and notes attached to messages.
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

// --------------------- Discovery & Enumeration -----------------
/**
 * Finds the primary scrollable container that holds the conversation.
 */

/**
 * Default MessageAdapter implementation built around raw DOM nodes.
 */
class DomMessageAdapter implements MessageAdapter {
    readonly key: string;
    readonly role: string;
    private textCache: string | null = null;

    constructor(readonly element: HTMLElement) {
        this.key = Utils.keyForMessage(element);
        this.role = element.getAttribute('data-message-author-role') || 'unknown';
    }

    /**
     * Returns normalized text content without extension UI nodes.
     */
    getText(): string {
        if (this.textCache !== null) return this.textCache;
        const clone = this.element.cloneNode(true) as HTMLElement;
        clone.querySelectorAll(`[${EXT_ATTR}]`).forEach(node => node.remove());
        clone.querySelectorAll('.ext-toolbar-row').forEach(node => node.remove());
        const source = clone.textContent ?? clone.innerText ?? '';
        this.textCache = Utils.normalizeText(source);
        return this.textCache;
    }

    /**
     * Indicates whether collapse controls should render for this message.
     */
    shouldShowCollapse(): boolean {
        return true;
    }

    /**
     * Builds the storage key for this message instance.
     */
    storageKey(threadKey: string): string {
        return `${threadKey}:${this.key}`;
    }
} // DomMessageAdapter

/**
 * Default PairAdapter mapping user/assistant message pairs.
 */
class DomPairAdapter implements PairAdapter {
    constructor(
        readonly index: number,
        readonly query: MessageAdapter | null,
        readonly response: MessageAdapter | null,
    ) { }

    /**
     * Returns the defined messages, filtering out nulls.
     */
    getMessages(): MessageAdapter[] {
        return [this.query, this.response].filter(Boolean) as MessageAdapter[];
    }
} // DomPairAdapter

/**
 * Provides DOM traversal helpers abstracted behind the ThreadAdapter interface.
 */
class ThreadDom {
    constructor(private readonly adapterProvider: () => ThreadAdapter | null) { }

    /**
     * Locates the main scrollable transcript container.
     */
    findTranscriptRoot(): HTMLElement {
        return this.adapterProvider()?.getTranscriptRoot() ?? ThreadDom.defaultFindTranscriptRoot();
    }

    /**
     * Returns DOM message elements within the provided root.
     */
    enumerateMessages(root: HTMLElement): HTMLElement[] {
        const adapter = this.adapterProvider();
        if (adapter) {
            return adapter.getMessages(root).map(message => message.element);
        }
        return ThreadDom.defaultEnumerateMessages(root);
    }

    /**
     * Builds prompt/response pairs from the current transcript.
     */
    getPairs(root: HTMLElement): TagalystPair[] {
        const adapter = this.adapterProvider();
        if (adapter) return adapter.getPairs(root).map(ThreadDom.toTagalystPair);
        return ThreadDom.defaultGetPairs(root);
    }

    /**
     * Returns nodes considered to be user prompts for navigation.
     */
    getPromptNodes(root: HTMLElement): HTMLElement[] {
        const adapter = this.adapterProvider();
        if (adapter) return adapter.getPromptMessages(root).map(ad => ad.element);
        return ThreadDom.defaultGetPromptNodes(root);
    }

    /**
     * Returns nodes used for focus navigation (prompts or fallback messages).
     */
    getNavigationNodes(root: HTMLElement): HTMLElement[] {
        const adapter = this.adapterProvider();
        if (adapter) return adapter.getNavigationMessages(root).map(ad => ad.element);
        return ThreadDom.defaultGetNavigationNodes(root);
    }

    /**
     * Returns the nth prompt/response pair.
     */
    getPair(root: HTMLElement, idx: number): TagalystPair | null {
        const adapter = this.adapterProvider();
        if (adapter) {
            const pair = adapter.getPairAt(root, idx);
            return pair ? ThreadDom.toTagalystPair(pair) : null;
        }
        return ThreadDom.defaultGetPair(root, idx);
    }

    /**
     * Builds pair adapters from a flat list of MessageAdapters.
     */
    buildPairAdaptersFromMessages(messages: MessageAdapter[]): DomPairAdapter[] {
        return ThreadDom.buildDomPairAdaptersFromMessages(messages);
    }

    static defaultFindTranscriptRoot(): HTMLElement {
        const main = (document.querySelector('main') as HTMLElement) || document.body;
        const candidates = Array.from(main.querySelectorAll<HTMLElement>('*')).filter(el => {
            const s = getComputedStyle(el);
            const scrollable = s.overflowY === 'auto' || s.overflowY === 'scroll';
            return scrollable && el.clientHeight > 300 && el.children.length > 1;
        });
        return (candidates.sort((a, b) => b.clientHeight - a.clientHeight)[0]) || main;
    }

    private static isMessageNode(el: HTMLElement | null) {
        if (!el) return false;
        return !!el.getAttribute?.('data-message-author-role');
    }

    static defaultEnumerateMessages(root: HTMLElement): HTMLElement[] {
        const nodes = Array.from(root.querySelectorAll<HTMLElement>('[data-message-author-role]'));
        if (nodes.length) return nodes;
        const out: HTMLElement[] = [];
        root.querySelectorAll<HTMLElement>('article, div').forEach(child => {
            if (ThreadDom.isMessageNode(child)) out.push(child);
        });
        return out;
    }

    static defaultDerivePairs(messages: HTMLElement[]): TagalystPair[] {
        const pairs: TagalystPair[] = [];
        for (let i = 0; i < messages.length; i += 2) {
            const query = messages[i];
            if (!query) break;
            const response = messages[i + 1] || null;
            pairs.push({
                query,
                response,
                queryId: Utils.getMessageId(query),
                responseId: response ? Utils.getMessageId(response) : null,
            });
        }
        return pairs;
    }

    static defaultGetPairs(root: HTMLElement): TagalystPair[] {
        return ThreadDom.defaultDerivePairs(ThreadDom.defaultEnumerateMessages(root));
    }

    static defaultGetPromptNodes(root: HTMLElement): HTMLElement[] {
        return ThreadDom.defaultGetPairs(root).map(p => p.query).filter(Boolean) as HTMLElement[];
    }

    static defaultGetNavigationNodes(root: HTMLElement): HTMLElement[] {
        const prompts = ThreadDom.defaultGetPromptNodes(root);
        if (prompts.length) return prompts;
        return ThreadDom.defaultEnumerateMessages(root);
    }

    static defaultGetPair(root: HTMLElement, idx: number): TagalystPair | null {
        if (idx < 0) return null;
        return ThreadDom.defaultGetPairs(root)[idx] || null;
    }

    static toTagalystPair(pair: PairAdapter): TagalystPair {
        const queryEl = pair.query?.element || null;
        const responseEl = pair.response?.element || null;
        return {
            query: queryEl,
            response: responseEl,
            queryId: queryEl ? Utils.getMessageId(queryEl) : null,
            responseId: responseEl ? Utils.getMessageId(responseEl) : null,
        };
    }

    static buildDomPairAdaptersFromMessages(messages: MessageAdapter[]): DomPairAdapter[] {
        const pairs: DomPairAdapter[] = [];
        for (let i = 0; i < messages.length; i += 2) {
            const query = messages[i] || null;
            const response = messages[i + 1] || null;
            pairs.push(new DomPairAdapter(pairs.length, query, response));
        }
        return pairs;
    }
} // ThreadDom

const threadDom = new ThreadDom(() => activeThreadAdapter);

/**
 * ThreadAdapter specialized for ChatGPT's DOM structure.
 */
class ChatGptThreadAdapter implements ThreadAdapter {
    private observer: MutationObserver | null = null;

    getTranscriptRoot(): HTMLElement | null {
        return ThreadDom.defaultFindTranscriptRoot();
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
        return ThreadDom.defaultEnumerateMessages(root).map(el => new DomMessageAdapter(el));
    }

    private buildPairAdapters(root: HTMLElement): DomPairAdapter[] {
        const messages = this.buildMessageAdapters(root);
        return ThreadDom.buildDomPairAdaptersFromMessages(messages);
    }
} // ChatGptThreadAdapter

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
