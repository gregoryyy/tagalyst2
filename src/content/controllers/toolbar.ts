/**
 * Composes toolbar rows for each message and manages the global control panel.
 */
type ToolbarDeps = {
    focusService: FocusService;
    focusController: FocusController;
    storageService: StorageService;
    editorController: EditorController;
    threadDom: ThreadDom;
    threadActions: ThreadActions;
    highlightController: HighlightController;
    overviewRulerController: OverviewRulerController;
};

class ToolbarController {
    constructor(private readonly deps: ToolbarDeps) { }
    private get focus() { return this.deps.focusService; }
    private get storage() { return this.deps.storageService; }
    private get editor() { return this.deps.editorController; }
    private get threadDom() { return this.deps.threadDom; }
    private get threadActions() { return this.deps.threadActions; }
    private get highlighter() { return this.deps.highlightController; }
    private get overview() { return this.deps.overviewRulerController; }
    private readonly debugFlag = '__tagalystDebugToolbar';
    private isDebugEnabled() { return (globalThis as any)[this.debugFlag] === true; }
    private log(label: string, data?: Record<string, unknown>) {
        if (!this.isDebugEnabled()) return;
        const payload = data ? ['[tagalyst][toolbar]', label, data] : ['[tagalyst][toolbar]', label];
        // eslint-disable-next-line no-console
        console.info(...payload);
    }
    /**
     * Ensures the target still belongs to the current transcript container.
     */
    private hasOwnership(target: HTMLElement | null): boolean {
        if (!target) return false;
        const container = this.threadDom.findTranscriptRoot();
        if (!container || !container.isConnected) return false;
        return container.contains(target);
    }


    /**
     * Creates the page-level navigation/collapse/export controls.
     */
    ensurePageControls(container: HTMLElement, threadKey: string) {
        this.log('page-controls:ensure', { threadKey });
        const existing = document.getElementById('ext-page-controls');
        if (existing) {
            this.log('page-controls:reuse', { threadKey });
            return existing;
        }
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
                const nodes = this.threadDom.getNavigationNodes(container);
                if (!nodes.length) return;
                this.scrollToNode(container, nodes.length - 1, 'end', nodes);
            };
        }
        if (jumpStarPrevBtn) jumpStarPrevBtn.onclick = () => { this.scrollFocus(-1); };
        if (jumpStarNextBtn) jumpStarNextBtn.onclick = () => { this.scrollFocus(1); };
        if (collapseAllBtn) collapseAllBtn.onclick = () => this.threadActions.toggleAll(container, true);
        if (collapseUnstarredBtn) collapseUnstarredBtn.onclick = () => this.threadActions.collapseByFocus(container, 'out', true);
        if (expandAllBtn) expandAllBtn.onclick = () => this.threadActions.toggleAll(container, false);
        if (expandStarredBtn) expandStarredBtn.onclick = () => this.threadActions.collapseByFocus(container, 'in', false);

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
        const nodes = list || this.threadDom.getNavigationNodes(container);
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
        const container = this.threadDom.findTranscriptRoot();
        if (!container || !container.isConnected) return;
        const nodes = this.threadDom.getNavigationNodes(container);
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
        this.log('toolbar:inject', { threadKey, hasExisting: !!el.querySelector('.ext-toolbar') });
        let toolbar = el.querySelector<HTMLElement>('.ext-toolbar');
        if (toolbar) {
            if (toolbar.dataset.threadKey !== threadKey) {
                this.log('toolbar:stale-remove', { prevKey: toolbar.dataset.threadKey, nextKey: threadKey });
                toolbar.closest('.ext-toolbar-row')?.remove();
                toolbar = null;
            } else {
                this.log('toolbar:reuse', { threadKey });
                this.threadActions.updateCollapseVisibility(el);
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
            collapseBtn.onclick = () => {
                if (!this.hasOwnership(el)) return;
                this.threadActions.collapse(el, !el.classList.contains('ext-collapsed'), false);
                this.threadActions.syncCollapseButton(el);
            };
        }
        if (focusBtn) {
            focusBtn.onclick = async () => {
                if (!this.hasOwnership(el)) return;
                if (this.focus.getMode() !== FOCUS_MODES.STARS) return;
                const adapter = messageMetaRegistry.resolveAdapter(el);
                const cur = await this.storage.readMessage(threadKey, adapter);
                cur.starred = !cur.starred;
                await this.storage.writeMessage(threadKey, adapter, cur);
                this.updateBadges(el, threadKey, cur, adapter);
                focusController.updateControlsUI();
                this.overview.refreshMarkers();
            };
        }
        if (tagBtn) tagBtn.onclick = () => { if (this.hasOwnership(el)) this.editor.openTagEditor(el, threadKey); };
        if (noteBtn) noteBtn.onclick = () => { if (this.hasOwnership(el)) this.editor.openNoteEditor(el, threadKey); };

        wrap.dataset.threadKey = threadKey;
        el.prepend(row);
        const adapter = messageMetaRegistry.resolveAdapter(el);
        if (adapter) {
            this.updateMessageLength(adapter);
        }
        this.threadActions.updateCollapseVisibility(el);
        this.threadActions.syncCollapseButton(el);
    }

    /**
     * Shows the pair index badge on user messages.
     */
    updatePairNumber(adapter: MessageAdapter, pairIndex: number | null) {
        const el = adapter.element;
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
        this.highlighter.applyHighlights(el, cur.highlights, adapterRef, threadKey);
        focusController.updateMessageButton(el, meta);
    }
} // ToolbarController

(globalThis as any).ToolbarController = ToolbarController;


/**
 * Provides DOM mutations for collapsing/expanding message rows.
 */
