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
