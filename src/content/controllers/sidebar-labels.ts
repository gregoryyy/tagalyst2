/// <reference path="../services/thread-metadata.ts" />
/// <reference path="../services/config.ts" />
/// <reference path="../utils.ts" />

/**
 * Injects badges (star/tags/size) into ChatGPT sidebar conversation list items.
 */
class SidebarLabelController {
    private observer: MutationObserver | null = null;
    private visibilityHandler: (() => void) | null = null;

    constructor(private readonly metadata: ThreadMetadataService, private readonly config: ConfigService) { }

    start() {
        this.stop(); // prevent duplicate observers/handlers
        if (!this.config.isSidebarLabelsEnabled()) {
            return;
        }
        const nav = document.querySelector('nav');
        if (!nav) return;
        this.renderAll(nav);
        this.observe(nav);
    }

    stop() {
        this.observer?.disconnect();
        this.observer = null;
        if (this.visibilityHandler) {
            document.removeEventListener('visibilitychange', this.visibilityHandler);
            this.visibilityHandler = null;
        }
        document.querySelectorAll('[data-ext="labels"]').forEach(el => el.remove());
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
            this.renderAll(nav);
        }, 150));
        this.observer.observe(nav, { childList: true, subtree: true });
        this.visibilityHandler = () => {
            if (document.visibilityState === 'visible') this.renderAll(nav);
        };
        document.addEventListener('visibilitychange', this.visibilityHandler);
    }

    private async renderAll(nav: Element) {
        const anchors = Array.from(nav.querySelectorAll<HTMLAnchorElement>('a[href*="/c/"]'));
        await Promise.all(anchors.map(anchor => this.renderItem(anchor)));
    }

    private async renderItem(link: HTMLAnchorElement) {
        if (!link || !link.href) return;
        const threadIdMatch = link.href.match(/\/c\/([^/?#]+)/);
        if (!threadIdMatch || !threadIdMatch[1]) return;
        const threadId = threadIdMatch[1];
        const meta = await this.metadata.read(threadId);

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
}

// Expose for tests
(globalThis as any).SidebarLabelController = SidebarLabelController;
