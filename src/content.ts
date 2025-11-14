/**
 * Tagalyst 2: ChatGPT DOM Tools — content script (MV3)
 * - Defensive discovery with MutationObserver
 * - Non-destructive overlays (no reparenting site nodes)
 * - Local persistence via chrome.storage
 */

const EXT_ATTR = 'data-ext-owned';

// -------------------------- Utilities --------------------------
namespace Utils {
    
    /**
     * Small helper for delaying async flows without blocking the UI thread.
     */
    export function sleep(ms: number) {
        return new Promise<void>(resolve => setTimeout(resolve, ms));
    }

    /**
     * Produces a deterministic 32-bit FNV-1a hash for lightweight keys.
     */
    export function hashString(s: string) {
        let h = 0x811c9dc5;
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
        }
        return ("0000000" + h.toString(16)).slice(-8);
    }

    export function normalizeText(t: string) {
        return (t || "")
            .replace(/\s+/g, " ")
            .replace(/[\u200B-\u200D\uFEFF]/g, "")
            .trim();
    }

    export function placeCaretAtEnd(el: HTMLElement) {
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = window.getSelection();
        if (!sel) return;
        sel.removeAllRanges();
        sel.addRange(range);
    }

    export function mountFloatingEditor(editor: HTMLElement, anchor: HTMLElement): () => void {
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

    /**
     * Generates a thread-level key using the conversation ID when available.
     */
    export function getThreadKey(): string {
        try {
            const u = new URL(location.href);
            if (u.pathname && u.pathname.length > 1) return u.pathname.replace(/\W+/g, "-");
        } catch { /* noop */ }
        return hashString(document.title + location.host);
    }

    /**
     * Returns the DOM-provided message UUID if available.
     */
    export function getMessageId(el: Element | null) {
        return el?.getAttribute?.('data-message-id') || null;
    }

    /**
     * Stable-ish per-message key derived from ChatGPT IDs or fallback heuristics.
     */
    export function keyForMessage(el: HTMLElement) {
        const domId = getMessageId(el);
        if (domId) return domId;
        const text = normalizeText(el.innerText).slice(0, 4000); // perf cap
        const idx = Array.prototype.indexOf.call(el.parentElement?.children || [], el);
        return hashString(text + "|" + idx);
    }

    /**
     * Flags a DOM node as extension-managed so MutationObservers can ignore it.
     */
    export function markExtNode(el: Element | null) {
        if (el?.setAttribute) {
            el.setAttribute(EXT_ATTR, '1');
        }
    }

    /**
     * Walks up from the provided node to see if any ancestor belongs to the extension.
     */
    export function closestExtNode(node: Node | null) {
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
    export function isExtensionNode(node: Node | null) {
        return !!closestExtNode(node);
    }

    /**
     * Determines whether a mutation record affects host content rather than extension nodes.
     */
    export function mutationTouchesExternal(record: MutationRecord) {
        if (!isExtensionNode(record.target)) return true;
        for (const node of record.addedNodes) {
            if (!isExtensionNode(node)) return true;
        }
        for (const node of record.removedNodes) {
            if (!isExtensionNode(node)) return true;
        }
        return false;
    }
} // Utils

class StorageService {
    async read(keys: string[]): Promise<Record<string, MessageValue>> {
        if (!Array.isArray(keys) || !keys.length) return {};
        return new Promise(resolve => chrome.storage.local.get(keys, resolve));
    }

    async write(record: Record<string, MessageValue>): Promise<void> {
        if (!record || !Object.keys(record).length) return;
        await new Promise<void>(resolve => chrome.storage.local.set(record, () => resolve()));
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
} // StorageService

const storageService = new StorageService();
class ConfigService {
    private loaded = false;
    private listeners = new Set<(cfg: typeof contentDefaultConfig) => void>();

    constructor(private storage: StorageService, private readonly scheduler: RenderScheduler) { }

    async load(): Promise<typeof contentDefaultConfig> {
        if (this.loaded) return config;
        const store = await this.storage.read([CONTENT_CONFIG_STORAGE_KEY]);
        this.apply(store[CONTENT_CONFIG_STORAGE_KEY]);
        this.loaded = true;
        return config;
    }

    apply(obj?: Partial<typeof contentDefaultConfig>) {
        config = { ...contentDefaultConfig, ...(obj || {}) };
        this.enforceState();
        this.notify();
        focusController.syncMode();
        this.scheduler.request();
    }

    async update(partial: Partial<typeof contentDefaultConfig>) {
        const next = { ...config, ...partial };
        await this.storage.write({ [CONTENT_CONFIG_STORAGE_KEY]: next });
        this.apply(next);
    }

    onChange(listener: (cfg: typeof contentDefaultConfig) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    isSearchEnabled() {
        return !!config.searchEnabled;
    }

    areTagsEnabled() {
        return !!config.tagsEnabled;
    }

    doesSearchExpand() {
        return this.isSearchEnabled() && !!config.searchExpands;
    }

    doTagsExpand() {
        return this.areTagsEnabled() && !!config.tagsExpands;
    }

    isOverviewEnabled() {
        return !!config.overviewEnabled;
    }

    private notify() {
        this.listeners.forEach(listener => listener(config));
    }

    private enforceState() {
        let changed = false;
        if (!this.isSearchEnabled()) {
            focusService.setSearchQuery('');
            topPanelController.clearSearchInput();
            changed = true;
        }
        if (!this.areTagsEnabled()) {
            focusService.clearTags();
            changed = true;
        }
        if (changed) focusController.syncMode();
    }
} // ConfigService

const CONTENT_CONFIG_STORAGE_KEY = '__tagalyst_config';
const contentDefaultConfig = {
    searchEnabled: true,
    tagsEnabled: true,
    overviewEnabled: true,
    searchExpands: true,
    tagsExpands: true,
};
let config = { ...contentDefaultConfig };
let activeThreadAdapter: ThreadAdapter | null = null;

type MessageValue = Record<string, any>;

type MessageMeta = {
    key: string | null;
    value: MessageValue;
    pairIndex: number | null;
    adapter: MessageAdapter | null;
};

class MessageMetaRegistry {
    private readonly store = new Map<HTMLElement, MessageMeta>();

    clear() {
        this.store.clear();
    }

    get(el: HTMLElement) {
        return this.store.get(el) || null;
    }

    delete(el: HTMLElement) {
        this.store.delete(el);
    }

    forEach(cb: (meta: MessageMeta, el: HTMLElement) => void) {
        this.store.forEach(cb);
    }

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

    resolveAdapter(el: HTMLElement): MessageAdapter {
        const meta = this.ensure(el);
        if (meta.adapter && meta.adapter.element === el) {
            return meta.adapter;
        }
        const adapter = new DomMessageAdapter(el);
        meta.adapter = adapter;
        return adapter;
    }

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

class RenderScheduler {
    private rafId: number | null = null;
    private renderer: (() => Promise<void>) | null = null;

    setRenderer(renderer: () => Promise<void>) {
        this.renderer = renderer;
    }

    request(renderer?: () => Promise<void>) {
        if (renderer) this.renderer = renderer;
        const target = renderer ?? this.renderer;
        if (!target) return;
        if (this.rafId) cancelAnimationFrame(this.rafId);
        this.rafId = requestAnimationFrame(() => {
            this.rafId = null;
            target();
        });
    }
} // RenderScheduler

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
        const wasSelected = this.selectedTags.has(tag);
        if (wasSelected) {
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
        if (configService.isSearchEnabled() && this.searchQueryLower) return FOCUS_MODES.SEARCH;
        if (configService.areTagsEnabled() && this.selectedTags.size) return FOCUS_MODES.TAGS;
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
        if (!configService.areTagsEnabled() || !this.selectedTags.size) return false;
        const tags = Array.isArray(value?.tags) ? value.tags : [];
        if (!tags.length) return false;
        return tags.some(tag => this.selectedTags.has(tag.toLowerCase()));
    }

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

class FocusController {
    private pageControls: PageControls | null = null;
    private selectionSync: (() => void) | null = null;

    constructor(private readonly focus: FocusService, private readonly messages: MessageMetaRegistry) { }

    reset() {
        this.focus.reset();
        this.pageControls = null;
        this.messages.clear();
    }

    attachSelectionSync(handler: () => void) {
        this.selectionSync = handler;
    }

    setPageControls(controls: PageControls | null) {
        this.pageControls = controls;
        this.updateControlsUI();
    }

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

    syncMode() {
        this.focus.syncMode();
        this.refreshButtons();
        this.updateControlsUI();
        this.selectionSync?.();
    }

    getMatches(): MessageAdapter[] {
        return this.focus.getMatches(this.messages);
    }

    getGlyph(isFilled: boolean) {
        return this.focus.getGlyph(isFilled);
    }

    describeMode() {
        return this.focus.describeMode();
    }

    getModeLabel() {
        return this.focus.getModeLabel();
    }

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

    syncSelectionUI() {
        if (!this.tagListEl) return;
        this.tagListEl.querySelectorAll<HTMLElement>('.ext-tag-sidebar-row').forEach(row => {
            const tag = row.dataset.tag;
            row.classList.toggle('ext-tag-selected', !!(tag && focusService.isTagSelected(tag)));
        });
    }

    private bindFrameHover(panel: 'search' | 'tags', frame: HTMLElement | null) {
        if (!frame) return;
        if (frame.dataset.hoverBound === '1') return;
        frame.dataset.hoverBound = '1';
        frame.addEventListener('mouseenter', () => this.handleFrameHover(panel, true));
        frame.addEventListener('mouseleave', () => this.handleFrameHover(panel, false));
        frame.addEventListener('focusin', () => this.handleFrameHover(panel, true));
        frame.addEventListener('focusout', () => this.handleFrameHover(panel, false));
    }

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

    private shouldExpand(panel: 'search' | 'tags') {
        return panel === 'search'
            ? configService.doesSearchExpand()
            : configService.doTagsExpand();
    }

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

    private computeTagSignature(counts: Array<{ tag: string; count: number }>, tagsEnabled: boolean) {
        const suffix = counts.map(({ tag, count }) => `${tag}:${count}`).join('|');
        return `${tagsEnabled ? '1' : '0'}|${suffix}`;
    }

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

    clearSearchInput() {
        if (this.searchInputEl) this.searchInputEl.value = '';
    }

    syncWidth() {
        if (!this.topPanelsEl) return;
        const controls = document.getElementById('ext-page-controls');
        const refWidth = controls ? controls.getBoundingClientRect().width : null;
        const width = refWidth && refWidth > 0 ? refWidth : 220;
        this.topPanelsEl.style.minWidth = `${Math.max(220, Math.round(width))}px`;
        this.topPanelsEl.style.width = 'auto';
    }

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

    getElement(): HTMLElement | null {
        return this.topPanelsEl;
    }

    private handleSearchInput(value: string) {
        if (!configService.isSearchEnabled()) return;
        focusService.setSearchQuery(value || '');
        focusController.syncMode();
        this.updateSearchResultCount();
    }

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
    label?: string | null;
};

class OverviewRulerController {
    private messageMarkerLayer: HTMLElement | null = null;
    private messageMarkerPool: HTMLElement[] = [];
    private messageMarkerData: MarkerDatum[] = [];
    private focusMarkerLayer: HTMLElement | null = null;
    private focusMarkerPool: HTMLElement[] = [];
    private focusMarkerData: MarkerDatum[] = [];
    private root: HTMLElement | null = null;
    private trackEl: HTMLElement | null = null;
    private container: HTMLElement | null = null;
    private rafPending = false;
    private topAnchor: HTMLElement | null = null;
    private bottomAnchor: HTMLElement | null = null;
    private lastMessageAnchor: HTMLElement | null = null;
    private viewportEl: HTMLElement | null = null;

    private readonly handleViewportChange = () => {
        if (!this.container) return;
        if (this.rafPending) return;
        this.rafPending = true;
        requestAnimationFrame(() => {
            this.rafPending = false;
            if (this.container) this.updatePosition(this.container);
        });
    };

    ensure(container: HTMLElement) {
        if (this.root) {
            this.container = container;
            this.updatePosition(container);
            return this.root;
        }
        const root = document.createElement('div');
        root.id = 'ext-overview-ruler';
        const track = document.createElement('div');
        track.className = 'ext-overview-ruler-track';
        const messageLayer = document.createElement('div');
        messageLayer.className = 'ext-overview-marker-layer ext-overview-marker-layer--messages';
        const focusLayer = document.createElement('div');
        focusLayer.className = 'ext-overview-marker-layer ext-overview-marker-layer--focus';
        const viewport = document.createElement('div');
        viewport.className = 'ext-ruler-viewport';
        track.appendChild(messageLayer);
        track.appendChild(focusLayer);
        track.appendChild(viewport);
        root.appendChild(track);
        Utils.markExtNode(root);
        document.body.appendChild(root);
        this.root = root;
        this.trackEl = track;
        this.messageMarkerLayer = messageLayer;
        this.focusMarkerLayer = focusLayer;
        this.viewportEl = viewport;
        this.container = container;
        window.addEventListener('scroll', this.handleViewportChange, { passive: true });
        window.addEventListener('resize', this.handleViewportChange);
        this.updatePosition(container);
        return root;
    }

    update(container: HTMLElement, entries: Array<{ adapter: MessageAdapter; pairIndex?: number | null }>) {
        if (!entries.length) return;
        this.ensure(container);
        if (!this.trackEl || !this.root) return;
        this.container = container;
        this.topAnchor = entries[0]?.adapter.element || null;
        this.lastMessageAnchor = entries[entries.length - 1]?.adapter.element || null;
        this.bottomAnchor = this.resolveComposerAnchor(container);
        const bounds = this.computeBounds(container);
        const scrollRange = this.computeScrollRange(container);
        this.messageMarkerData = this.collectMessageMarkerData(entries);
        this.focusMarkerData = this.collectFocusMarkerData();
        this.applyFrame(container, bounds);
        if (!this.viewportEl || !this.viewportEl.isConnected) {
            this.viewportEl = document.createElement('div');
            this.viewportEl.className = 'ext-ruler-viewport';
            this.trackEl.appendChild(this.viewportEl);
        }
        this.updateViewportIndicator(scrollRange);
        this.layoutAllMarkers(scrollRange);
    }

    refreshMarkers() {
        if (!this.container || !configService.isOverviewEnabled()) return;
        const scrollRange = this.computeScrollRange(this.container);
        this.focusMarkerData = this.collectFocusMarkerData();
        this.layoutFocusMarkers(scrollRange);
    }

    reset() {
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
        this.focusMarkerLayer = null;
        this.focusMarkerPool = [];
        this.focusMarkerData = [];
        window.removeEventListener('scroll', this.handleViewportChange);
        window.removeEventListener('resize', this.handleViewportChange);
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
        const viewportTop = window.scrollY;
        const viewportBottom = viewportTop + window.innerHeight;
        const intersectionTop = Math.max(viewportTop, scrollRange.top);
        const intersectionBottom = Math.min(viewportBottom, scrollRange.bottom);
        const visibleSpan = Math.max(0, intersectionBottom - intersectionTop);
        if (visibleSpan <= 0 || scrollHeight <= 1) {
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
        this.layoutFocusMarkers(scrollRange);
    }

    private collectMessageMarkerData(entries: Array<{ adapter: MessageAdapter; pairIndex?: number | null }>): MarkerDatum[] {
        const data: MarkerDatum[] = [];
        const seenPairs = new Set<number>();
        let fallbackIndex = 0;
        for (const { adapter, pairIndex } of entries) {
            const el = adapter?.element;
            if (!el || !document.contains(el)) continue;
            if (typeof pairIndex === 'number') {
                if (seenPairs.has(pairIndex)) continue;
                seenPairs.add(pairIndex);
            }
            const rect = el.getBoundingClientRect();
            const docCenter = rect.top + window.scrollY + (rect.height / 2 || 0);
            if (!Number.isFinite(docCenter)) continue;
            const label = typeof pairIndex === 'number' ? String(pairIndex + 1) : String(++fallbackIndex);
            data.push({ docCenter, label });
        }
        return data;
    }

    private collectFocusMarkerData(): MarkerDatum[] {
        const adapters = focusController.getMatches();
        const data: MarkerDatum[] = [];
        for (const adapter of adapters) {
            const el = adapter?.element;
            if (!el || !document.contains(el)) continue;
            const rect = el.getBoundingClientRect();
            const docCenter = rect.top + window.scrollY + (rect.height / 2 || 0);
            if (!Number.isFinite(docCenter)) continue;
            data.push({ docCenter });
        }
        return data;
    }

    private layoutMessageMarkers(scrollRange: { top: number; bottom: number }) {
        this.layoutMarkerSet({
            layer: this.messageMarkerLayer,
            pool: this.messageMarkerPool,
            data: this.messageMarkerData,
            scrollRange,
            className: 'ext-overview-marker ext-overview-marker--message',
            formatter: (marker, datum) => {
                marker.textContent = datum.label ?? '';
            }
        });
    }

    private layoutFocusMarkers(scrollRange: { top: number; bottom: number }) {
        this.layoutMarkerSet({
            layer: this.focusMarkerLayer,
            pool: this.focusMarkerPool,
            data: this.focusMarkerData,
            scrollRange,
            className: 'ext-overview-marker ext-overview-marker--focus',
            color: this.getMarkerColor()
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
            marker.style.top = `${ratio * 100}%`;
            marker.style.display = 'block';
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
            layer.appendChild(marker);
            pool.push(marker);
        }
        return pool[index];
    }

    private getMarkerColor(): string {
        const mode = focusService.getMode();
        return focusMarkerColors[mode] || focusMarkerColors[FOCUS_MODES.STARS];
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
        let top: number;
        if (topMessageRect) {
            top = topMessageRect.top + window.scrollY;
        } else if (headerRect) {
            top = headerRect.bottom + 4 + window.scrollY;
        } else {
            top = containerRect.top + window.scrollY;
        }
        const bottomSource = lastMessageRect || bottomAnchorRect || containerRect;
        let bottom = bottomSource.bottom + window.scrollY;
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
    if (!cfg.overviewEnabled) {
        overviewRulerController.reset();
    } else {
        overviewRulerController.refreshMarkers();
    }
});

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
    private readonly onMouseMove = (evt: MouseEvent) => this.handleMouseMove(evt);
    private readonly cssHighlightSupported = typeof CSS !== 'undefined' && 'highlights' in CSS && typeof (window as any).Highlight !== 'undefined';

    constructor(private readonly storage: StorageService) { }

    init() {
        if (this.initialized) return;
        const handler = () => this.scheduleSelectionCheck();
        document.addEventListener('mouseup', handler, true);
        document.addEventListener('keyup', handler, true);
        document.addEventListener('selectionchange', handler);
        document.addEventListener('mousedown', (evt) => this.handleDocumentMouseDown(evt), true);
        document.addEventListener('mousemove', this.onMouseMove, true);
        document.addEventListener('scroll', () => this.hideHoverTooltip(), true);
        this.initialized = true;
    }

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
    }

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
            segments.push(`${annotated.map(name => `::highlight(${name})`).join(', ')} { background: rgba(255, 190, 0, .5); border-radius: 3px; box-shadow: inset 0 0 0 1px rgba(255, 120, 0, .45); }`);
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
        if (!this.highlightMeta.size) {
            this.hideHoverTooltip();
            return;
        }
        const x = evt.clientX;
        const y = evt.clientY;
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
        if (match) {
            this.showHoverTooltip(match.text, match.rect, match.id);
        } else {
            this.hideHoverTooltip();
        }
    }

    private showHoverTooltip(text: string, rect: DOMRect, id: string) {
        const tooltip = this.ensureHoverTooltip();
        tooltip.textContent = text || 'Hello World';
        tooltip.style.display = 'block';
        const top = window.scrollY + rect.bottom + 6;
        const left = window.scrollX + rect.left;
        tooltip.style.top = `${top}px`;
        tooltip.style.left = `${left}px`;
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
}

const highlightController = new HighlightController(storageService);
highlightController.init();

/**
 * Moves the caret to the end of a contenteditable element.
 */
function placeCaretAtEnd(el: HTMLElement) {
    Utils.placeCaretAtEnd(el);
}

/**
 * Positions floating editor UI relative to an anchor and keeps it in view.
 */
function mountFloatingEditor(editor: HTMLElement, anchor: HTMLElement): () => void {
    return Utils.mountFloatingEditor(editor, anchor);
}

// --------------------- Discovery & Enumeration -----------------
/**
 * Finds the primary scrollable container that holds the conversation.
 */

class DomMessageAdapter implements MessageAdapter {
    readonly key: string;
    readonly role: string;
    private textCache: string | null = null;

    constructor(readonly element: HTMLElement) {
        this.key = Utils.keyForMessage(element);
        this.role = element.getAttribute('data-message-author-role') || 'unknown';
    }

    getText(): string {
        if (this.textCache !== null) return this.textCache;
        const clone = this.element.cloneNode(true) as HTMLElement;
        clone.querySelectorAll(`[${EXT_ATTR}]`).forEach(node => node.remove());
        clone.querySelectorAll('.ext-toolbar-row').forEach(node => node.remove());
        const source = clone.textContent ?? clone.innerText ?? '';
        this.textCache = Utils.normalizeText(source);
        return this.textCache;
    }

    shouldShowCollapse(): boolean {
        return true;
    }

    storageKey(threadKey: string): string {
        return `${threadKey}:${this.key}`;
    }
} // DomMessageAdapter

class DomPairAdapter implements PairAdapter {
    constructor(
        readonly index: number,
        readonly query: MessageAdapter | null,
        readonly response: MessageAdapter | null,
    ) { }

    getMessages(): MessageAdapter[] {
        return [this.query, this.response].filter(Boolean) as MessageAdapter[];
    }
} // DomPairAdapter

class ThreadDom {
    constructor(private readonly adapterProvider: () => ThreadAdapter | null) { }

    findTranscriptRoot(): HTMLElement {
        return this.adapterProvider()?.getTranscriptRoot() ?? ThreadDom.defaultFindTranscriptRoot();
    }

    enumerateMessages(root: HTMLElement): HTMLElement[] {
        const adapter = this.adapterProvider();
        if (adapter) {
            return adapter.getMessages(root).map(message => message.element);
        }
        return ThreadDom.defaultEnumerateMessages(root);
    }

    getPairs(root: HTMLElement): TagalystPair[] {
        const adapter = this.adapterProvider();
        if (adapter) return adapter.getPairs(root).map(ThreadDom.toTagalystPair);
        return ThreadDom.defaultGetPairs(root);
    }

    getPromptNodes(root: HTMLElement): HTMLElement[] {
        const adapter = this.adapterProvider();
        if (adapter) return adapter.getPromptMessages(root).map(ad => ad.element);
        return ThreadDom.defaultGetPromptNodes(root);
    }

    getNavigationNodes(root: HTMLElement): HTMLElement[] {
        const adapter = this.adapterProvider();
        if (adapter) return adapter.getNavigationMessages(root).map(ad => ad.element);
        return ThreadDom.defaultGetNavigationNodes(root);
    }

    getPair(root: HTMLElement, idx: number): TagalystPair | null {
        const adapter = this.adapterProvider();
        if (adapter) {
            const pair = adapter.getPairAt(root, idx);
            return pair ? ThreadDom.toTagalystPair(pair) : null;
        }
        return ThreadDom.defaultGetPair(root, idx);
    }

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

class ToolbarController {
    constructor(private readonly focus: FocusService, private readonly storage: StorageService) { }

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
            if (target) target.element.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
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
        this.scrollToNode(container, targetIdx, 'start', nodes);
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


class ThreadActions {
    updateCollapseVisibility(el: HTMLElement) {
        const btn = this.getCollapseButton(el);
        if (!btn) return;
        btn.style.display = '';
    }

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

class ExportController {
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
class BootstrapOrchestrator {
    private refreshRunning = false;
    private refreshQueued = false;
    private threadAdapter: ThreadAdapter | null = null;

    constructor(private readonly toolbar: ToolbarController, private readonly storage: StorageService) { }

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

    private resolveMessages(container: HTMLElement): MessageAdapter[] {
        const threadAdapter = this.threadAdapter;
        return (threadAdapter
            ? threadAdapter.getMessages(container)
            : ThreadDom.defaultEnumerateMessages(container).map(el => new DomMessageAdapter(el)));
    }

    private buildPairMap(pairAdapters: PairAdapter[]): Map<MessageAdapter, number> {
        const pairMap = new Map<MessageAdapter, number>();
        pairAdapters.forEach((pair, idx) => {
            pair.getMessages().forEach(msg => pairMap.set(msg, idx));
        });
        return pairMap;
    }

    private hasMessages(container: HTMLElement) {
        return threadDom.enumerateMessages(container).length > 0;
    }

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
