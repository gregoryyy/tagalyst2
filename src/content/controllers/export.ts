/**
 * Handles Markdown export for full threads or focused subsets.
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

// ---------------------- Orchestration --------------------------
/**
 * Entry point: finds the thread, injects UI, and watches for updates.
 */
/**
 * Coordinates thread discovery, toolbar injection, and mutation observation.
 */
