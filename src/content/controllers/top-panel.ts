/// <reference path="../state/focus.ts" />
/// <reference path="../services/config.ts" />

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

    constructor(
        private readonly focusService: FocusService,
        private readonly configService: ConfigService,
        private readonly focusController: FocusController,
        private readonly requestRender: () => void = () => { },
    ) { }

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
            this.searchInputEl.value = this.focusService.getSearchQuery();
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
        const tagsEnabled = this.configService.areTagsEnabled();
        const signature = this.computeTagSignature(counts, tagsEnabled);
        if (!this.tagListEl) {
            return;
        }
        if (signature === this.lastTagSignature) {
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
            row.classList.toggle('ext-tag-selected', this.focusService.isTagSelected(tag));
            row.addEventListener('click', () => this.toggleTagSelection(tag, row));
            this.tagListEl.appendChild(row);
        }
        this.syncSelectionUI();
    }

    syncSelectionUI() {
        if (!this.tagListEl) return;
        this.tagListEl.querySelectorAll<HTMLElement>('.ext-tag-sidebar-row').forEach(row => {
            const tag = row.dataset.tag;
            row.classList.toggle('ext-tag-selected', !!(tag && this.focusService.isTagSelected(tag)));
        });
    }

    clearSearchInput() {
        if (this.searchInputEl) this.searchInputEl.value = '';
    }

    updateConfigUI() {
        if (!this.topPanelsEl) return;
        const searchPanel = this.topPanelsEl.querySelector<HTMLElement>('.ext-top-search');
        const tagPanel = this.topPanelsEl.querySelector<HTMLElement>('.ext-top-tags');
        if (searchPanel) searchPanel.style.display = this.configService.isSearchEnabled() ? '' : 'none';
        if (tagPanel) tagPanel.style.display = this.configService.areTagsEnabled() ? '' : 'none';
        if (this.searchInputEl) {
            const enabled = this.configService.isSearchEnabled();
            this.searchInputEl.disabled = !enabled;
            this.searchInputEl.placeholder = enabled ? 'Search messages…' : 'Search disabled in Options';
            if (!enabled) this.searchInputEl.value = '';
        }
        if (this.tagListEl) {
            this.tagListEl.classList.toggle('ext-tags-disabled', !this.configService.areTagsEnabled());
        }
        this.updateSearchResultCount();
        this.updateExpandState();
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

    syncWidth() {
        if (!this.topPanelsEl) return;
        const controls = document.getElementById('ext-page-controls');
        const refWidth = controls ? controls.getBoundingClientRect().width : null;
        const width = refWidth && refWidth > 0 ? refWidth : 220;
        this.topPanelsEl.style.minWidth = `${Math.max(220, Math.round(width))}px`;
        this.topPanelsEl.style.width = 'auto';
    }

    updateSearchResultCount() {
        if (!this.searchResultCountEl) return;
        if (!this.configService.isSearchEnabled()) {
            this.searchResultCountEl.textContent = '';
            return;
        }
        const query = this.focusService.getSearchQuery();
        if (!query) {
            this.searchResultCountEl.textContent = '';
            return;
        }
        const count = this.focusController.getMatches().length;
        this.searchResultCountEl.textContent = count === 1 ? '1 result' : `${count} results`;
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
            ? this.configService.doesSearchExpand()
            : this.configService.doTagsExpand();
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

    private handleSearchInput(value: string) {
        if (!this.configService.isSearchEnabled()) return;
        this.focusService.setSearchQuery(value || '');
        this.focusController.syncMode();
        this.updateSearchResultCount();
        this.requestRender();
    }

    private toggleTagSelection(tag: string, row?: HTMLElement) {
        if (!this.configService.areTagsEnabled()) {
            return;
        }
        const willSelect = !this.focusService.isTagSelected(tag);
        this.focusService.toggleTag(tag);
        if (row) {
            row.classList.toggle('ext-tag-selected', willSelect);
        }
        this.focusController.syncMode();
        this.requestRender();
    }
}

// Expose for testing
(globalThis as any).TopPanelController = TopPanelController;
