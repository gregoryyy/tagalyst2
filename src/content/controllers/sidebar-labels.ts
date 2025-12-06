/// <reference path="../services/thread-metadata.ts" />
/// <reference path="../services/config.ts" />
/// <reference path="../utils.ts" />

/**
 * Injects badges (star/tags/size) into ChatGPT sidebar conversation list items.
 */
class SidebarLabelController {
    private observer: MutationObserver | null = null;
    private visibilityHandler: (() => void) | null = null;
    private retryTimer: number | null = null;
    private retryAttempts = 0;
    private isStopped = false;
    private readonly retryDelayMs = 250;
    private readonly debugFlag = '__tagalystDebugSidebar';
    private isDebugEnabled() { return (globalThis as any)[this.debugFlag] === true; }
    private log(label: string, data?: Record<string, unknown>) {
        if (!this.isDebugEnabled()) return;
        const payload = data ? ['[tagalyst][sidebar]', label, data] : ['[tagalyst][sidebar]', label];
        // eslint-disable-next-line no-console
        console.info(...payload);
    }

    constructor(private readonly metadata: ThreadMetadataService, private readonly config: ConfigService) { }

    start() {
        this.stop(); // prevent duplicate observers/handlers
        this.isStopped = false;
        if (!this.config.isSidebarLabelsEnabled()) {
            return;
        }
        const nav = document.querySelector('nav');
        if (!nav) {
            this.log('start:retry', { attempts: this.retryAttempts });
            this.scheduleRetry();
            return;
        }
        this.retryAttempts = 0;
        this.log('start', { hasNav: !!nav });
        this.renderAll(nav);
        this.observe(nav);
    }

    stop() {
        this.observer?.disconnect();
        this.observer = null;
        this.isStopped = true;
        if (this.visibilityHandler) {
            document.removeEventListener('visibilitychange', this.visibilityHandler);
            this.visibilityHandler = null;
        }
        if (this.retryTimer) {
            clearTimeout(this.retryTimer);
            this.retryTimer = null;
        }
        this.retryAttempts = 0;
        document.querySelectorAll('[data-ext="labels"]').forEach(el => el.remove());
        this.log('stop');
    }

    private observe(nav: Element) {
        this.observer = new MutationObserver(Utils.debounce((records: MutationRecord[]) => {
            // Ignore mutations caused by our own injected nodes.
            const external = records.some(rec => {
                if (!Utils.isExtensionNode(rec.target)) return true;
                for (const n of Array.from(rec.addedNodes)) if (!Utils.isExtensionNode(n)) return true;
                for (const n of Array.from(rec.removedNodes)) if (!Utils.isExtensionNode(n)) return true;
                return false;
            });
            if (!external) return;
            this.log('mutations');
            this.renderAll(nav);
        }, 150));
        this.observer.observe(nav, { childList: true, subtree: true });
        this.visibilityHandler = () => {
            if (document.visibilityState === 'visible') this.renderAll(nav);
        };
        document.addEventListener('visibilitychange', this.visibilityHandler);
    }

    private async renderAll(nav: Element) {
        if (this.isStopped || !this.config.isSidebarLabelsEnabled()) {
            this.stop();
            return;
        }
        const anchors = Array.from(nav.querySelectorAll<HTMLAnchorElement>('a[href*="/c/"]'));
        await Promise.all(anchors.map(anchor => this.renderItem(anchor)));
    }

    private async renderItem(link: HTMLAnchorElement) {
        if (this.isStopped || !this.config.isSidebarLabelsEnabled()) return;
        if (!link || !link.href) return;
        const threadIdMatch = link.href.match(/\/c\/([^/?#]+)/);
        if (!threadIdMatch || !threadIdMatch[1]) return;
        const threadId = threadIdMatch[1];
        const meta = await this.metadata.read(threadId);
        if (this.isStopped || !this.config.isSidebarLabelsEnabled()) return;

        // Remove stray duplicates before injecting.
        const existing = link.querySelectorAll<HTMLElement>('[data-ext="labels"]');
        if (existing.length > 1) {
            existing.forEach((node, idx) => { if (idx > 0) node.remove(); });
        }
        let badge = link.querySelector<HTMLElement>('[data-ext="labels"]');
        if (!badge) {
            badge = document.createElement('span');
            badge.dataset.ext = 'labels';
            Utils.markExtNode(badge);
            badge.style.marginLeft = '6px';
            badge.style.display = 'inline-flex';
            badge.style.alignItems = 'center';
            badge.style.gap = '6px';
            badge.style.fontSize = '12px';
            badge.style.color = '#444';
            link.appendChild(badge);
        } else {
            badge.innerHTML = '';
        }

        if (meta.starred) {
            const star = document.createElement('span');
            star.textContent = '★';
            star.style.color = '#e3a008';
            badge.appendChild(star);
        }

        if (meta.tags?.length) {
            const tags = document.createElement('span');
            tags.textContent = meta.tags.join(', ');
            badge.appendChild(tags);
        }

        if (meta.note) {
            const note = document.createElement('span');
            note.textContent = '📝';
            badge.appendChild(note);
        }

        if (typeof meta.length === 'number' && meta.length > 0) {
            const length = document.createElement('span');
            length.textContent = `(${meta.length})`;
            badge.appendChild(length);
        }
    }

    private scheduleRetry() {
        if (this.retryTimer || this.retryAttempts >= 3) return;
        this.retryAttempts += 1;
        this.retryTimer = window.setTimeout(() => {
            this.retryTimer = null;
            this.start();
        }, this.retryDelayMs);
    }
}

// Expose for tests
(globalThis as any).SidebarLabelController = SidebarLabelController;
