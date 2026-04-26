/// <reference path="../services/thread-metadata.ts" />
/// <reference path="../services/config.ts" />
/// <reference path="../utils.ts" />

/**
 * Injects metadata badges into the project thread list on the right pane.
 */
class ProjectListLabelController {
    private observer: MutationObserver | null = null;
    private retryTimer: number | null = null;
    private waitObserver: MutationObserver | null = null;
    private readonly retryDelayMs = 250;
    private readonly debugFlag = '__tagalystDebugSidebar';
    private isDebugEnabled() { return (globalThis as any)[this.debugFlag] === true; }
    private log(label: string, data?: Record<string, unknown>) {
        if (!this.isDebugEnabled()) return;
        const payload = data ? ['[tagalyst][projects]', label, data] : ['[tagalyst][projects]', label];
        // eslint-disable-next-line no-console
        console.info(...payload);
    }

    constructor(private readonly metadata: ThreadMetadataService, private readonly config: ConfigService) { }

    start() {
        this.stop();
        if (!this.config.isSidebarLabelsEnabled()) return;
        const root = document.querySelector('main') || document.body;
        if (!root) {
            this.log('start:wait');
            this.scheduleRetry();
            this.waitForRoot();
            return;
        }
        this.log('start', { hasRoot: !!root });
        this.renderAll(root);
        this.observe(root);
    }

    stop() {
        this.observer?.disconnect();
        this.observer = null;
        this.waitObserver?.disconnect();
        this.waitObserver = null;
        if (this.retryTimer) {
            clearTimeout(this.retryTimer);
            this.retryTimer = null;
        }
        document.querySelectorAll('[data-ext="project-labels"]').forEach(el => el.remove());
        this.log('stop');
    }

    private observe(root: Element) {
        this.observer = new MutationObserver(Utils.debounce((records: MutationRecord[]) => {
            const external = records.some(rec => Utils.mutationTouchesExternal(rec));
            if (!external) return;
            this.log('mutations');
            this.renderAll(root);
        }, 150));
        this.observer.observe(root, { childList: true, subtree: true });
    }

    private async renderAll(root?: Element) {
        const scope = root || document;
        const items = Array.from(scope.querySelectorAll<HTMLAnchorElement>('li[class*="project-item"] a[href*="/c/"]'));
        await Promise.all(items.map(item => this.renderItem(item)));
    }

    private async renderItem(link: HTMLAnchorElement) {
        const href = link.getAttribute('href') || '';
        const match = href.match(/\/c\/([^/?#]+)/);
        if (!match) return;
        const threadId = match[1];
        const meta = await this.metadata.read(threadId);

        const existing = link.querySelectorAll<HTMLElement>('[data-ext="project-labels"]');
        if (existing.length > 1) {
            existing.forEach((node, idx) => { if (idx > 0) node.remove(); });
        }
        let badge = link.querySelector<HTMLElement>('[data-ext="project-labels"]');
        if (!badge) {
            badge = document.createElement('div');
            badge.dataset.ext = 'project-labels';
            Utils.markExtNode(badge);
            badge.style.marginTop = '4px';
            badge.style.display = 'flex';
            badge.style.flexWrap = 'wrap';
            badge.style.gap = '6px';
            badge.style.fontSize = '12px';
            badge.style.color = '#444';
            link.appendChild(badge);
        } else {
            badge.innerHTML = '';
        }

        const fragments: string[] = [];
        if (meta.length && meta.length > 0) fragments.push(`${meta.length} prompts`);
        if (typeof meta.chars === 'number' && meta.chars > 0) {
            const chars = meta.chars >= 10000 ? `${Math.round(meta.chars / 1000)}k` : `${meta.chars}`;
            fragments.push(`${chars} chars`);
        }
        if (meta.tags?.length) fragments.push(meta.tags.join(', '));
        if (meta.note) fragments.push(meta.note);
        if (meta.starred) fragments.push('★');

        if (!fragments.length) {
            badge.textContent = '';
            badge.style.display = 'none';
        } else {
            badge.style.display = 'flex';
            badge.textContent = fragments.join(' · ');
        }
    }

    private scheduleRetry() {
        if (this.retryTimer) return;
        this.retryTimer = window.setTimeout(() => {
            this.retryTimer = null;
            this.start();
        }, this.retryDelayMs);
    }

    private waitForRoot() {
        if (this.waitObserver) return;
        const host = document.body || document.documentElement;
        if (!host) return;
        this.waitObserver = new MutationObserver(() => {
            if (!(document.querySelector('main') || document.body)) return;
            this.waitObserver?.disconnect();
            this.waitObserver = null;
            this.start();
        });
        this.waitObserver.observe(host, { childList: true, subtree: true });
    }
}

// Expose for tests
(globalThis as any).ProjectListLabelController = ProjectListLabelController;
