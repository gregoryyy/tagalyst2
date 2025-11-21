/**
 * Provides DOM mutations for collapsing/expanding message rows.
 */
class ThreadActions {
    constructor(private readonly threadDom: ThreadDom) { }
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
        const msgs = this.threadDom.enumerateMessages(container);
        for (const m of msgs) this.collapse(m, !!yes);
    }
    
    /**
     * Applies collapse state against the current focus subset.
     */
    collapseByFocus(container: HTMLElement, target: 'in' | 'out', collapseState: boolean) {
        const matches = focusController.getMatches();
        if (!matches.length) return;
        const matchSet = new Set(matches.map(adapter => adapter.element));
        for (const el of this.threadDom.enumerateMessages(container)) {
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

/**
 * Handles assembling Markdown exports for focused or full threads.
 */
