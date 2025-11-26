/**
 * Handles CSS highlighter interactions, selection menus, and hover annotations.
 */
class HighlightController {
    constructor(
        private readonly storage: StorageService,
        private readonly overviewRuler: OverviewRulerController,
        private readonly requestRender: () => void = () => { },
    ) { }
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
        this.requestRender();
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
        this.requestRender();
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
        this.requestRender();
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
                const docCenter = this.overviewRuler.measureScrollSpaceCenter(rect);
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
        const anchor = (this.selectionMenu || message) as HTMLElement;
        new EditorController(this.storage).openTextEditor({
            anchor,
            value: target.annotation || '',
            placeholder: 'Add details…',
            title: 'Annotation',
            saveOnEnter: true,
            onSave: async (next) => {
                const trimmed = (next || '').trim();
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
            },
        });
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
