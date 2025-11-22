/// <reference path="../services/thread-metadata.ts" />
/// <reference path="../services/config.ts" />
/// <reference path="../utils.ts" />

/**
 * Injects badges (star/tags/size) into ChatGPT sidebar conversation list items.
 */
class SidebarLabelController {
    private observer: MutationObserver | null = null;
    private teardownFn: (() => void) | null = null;

    constructor(private readonly metadata: ThreadMetadataService, private readonly config: ConfigService) { }

    start() {
        if (!this.config.isSidebarLabelsEnabled()) return;
        const nav = document.querySelector('nav');
        if (!nav) return;
        this.renderAll(nav);
        this.observe(nav);
    }

    stop() {
        this.observer?.disconnect();
        this.observer = null;
    }

    private observe(nav: Element) {
        this.observer = new MutationObserver(Utils.debounce(() => this.renderAll(nav), 150));
        this.observer.observe(nav, { childList: true, subtree: true });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') this.renderAll(nav);
        });
    }

    private async renderAll(nav: Element) {
        const items = Array.from(nav.querySelectorAll<HTMLElement>('[data-testid^="history-item-"]'));
        for (const item of items) {
            this.renderItem(item);
        }
    }

    private async renderItem(item: HTMLElement) {
        const link = item.closest('a') as HTMLAnchorElement | null;
        if (!link || !link.href) return;
        const threadIdMatch = link.href.match(/\/c\/([^/?#]+)/);
        if (!threadIdMatch || !threadIdMatch[1]) return;
        const threadId = threadIdMatch[1];
        const projectMatch = link.href.match(/\/g\/([^/]+)/);
        const projectId = projectMatch ? projectMatch[1] : null;
        const meta = await this.metadata.read(threadIdKey(threadId, projectId));

        let badge = item.querySelector<HTMLElement>('[data-ext="labels"]');
        if (!badge) {
            badge = document.createElement('span');
            badge.dataset.ext = 'labels';
            badge.style.marginLeft = '6px';
            badge.style.display = 'inline-flex';
            badge.style.alignItems = 'center';
            badge.style.gap = '6px';
            badge.style.fontSize = '12px';
            badge.style.color = '#444';
            item.appendChild(badge);
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

        if (typeof meta.length === 'number') {
            const length = document.createElement('span');
            length.textContent = `${meta.length} prompts`;
            badge.appendChild(length);
        }
    }
}

function threadIdKey(threadId: string, projectId: string | null) {
    return projectId ? `${projectId}:${threadId}` : threadId;
}
