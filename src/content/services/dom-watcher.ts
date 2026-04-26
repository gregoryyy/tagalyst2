/// <reference path="../utils.ts" />
/// <reference path="../../types/globals.d.ts" />

type DomWatcherHandlers = {
    onMutations: () => void;
    onNav: () => void;
    onRootChange?: (prev: HTMLElement | null, next: HTMLElement | null) => void;
};

/**
 * Centralizes DOM/URL watching and emits normalized events for render orchestration.
 */
class DomWatcher {
    private mutationObserver: MutationObserver | null = null;
    private lastHref: string = location.href;
    private urlTimer: number | null = null;
    private currentRoot: HTMLElement | null = null;
    private historyPatched = false;
    private readonly handleHistoryEvent = () => this.checkUrl();

    constructor(private readonly handlers: DomWatcherHandlers) { }

    /**
     * Begins observing transcript container mutations.
     */
    watchContainer(container: HTMLElement | null) {
        this.stopMutationObserver();
        const prev = this.currentRoot;
        if (this.currentRoot !== container) {
            this.handlers.onRootChange?.(prev, container);
            this.currentRoot = container;
        }
        if (!container) return;
        this.mutationObserver = new MutationObserver(records => {
            if (!this.currentRoot) return;
            if (records.some(Utils.mutationTouchesExternal)) {
                this.handlers.onMutations();
            }
        });
        this.mutationObserver.observe(container, { childList: true, subtree: true });
    }

    /**
     * Starts SPA URL change detection.
     */
    watchUrl() {
        this.lastHref = location.href;
        this.stopUrlWatch();
        this.patchHistory();
        window.addEventListener('popstate', this.handleHistoryEvent);
        window.addEventListener('tagalyst:locationchange', this.handleHistoryEvent);
        this.urlTimer = window.setInterval(() => this.checkUrl(), 800);
    }

    private checkUrl() {
        if (location.href === this.lastHref) return;
        this.lastHref = location.href;
        this.handlers.onNav();
    }

    private patchHistory() {
        if (this.historyPatched) return;
        const w = window as any;
        if (w.__tagalystHistoryPatched) {
            this.historyPatched = true;
            return;
        }
        const dispatch = () => window.dispatchEvent(new Event('tagalyst:locationchange'));
        const wrap = (key: 'pushState' | 'replaceState') => {
            const original = history[key];
            history[key] = function (this: History, ...args: any[]) {
                const result = (original as any).apply(this, args);
                dispatch();
                return result;
            } as any;
        };
        wrap('pushState');
        wrap('replaceState');
        w.__tagalystHistoryPatched = true;
        this.historyPatched = true;
    }

    stopMutationObserver() {
        if (this.mutationObserver) {
            this.mutationObserver.disconnect();
            this.mutationObserver = null;
        }
    }

    stopUrlWatch() {
        if (this.urlTimer) {
            clearInterval(this.urlTimer);
            this.urlTimer = null;
        }
        window.removeEventListener('popstate', this.handleHistoryEvent);
        window.removeEventListener('tagalyst:locationchange', this.handleHistoryEvent);
    }

    teardown() {
        this.stopMutationObserver();
        this.stopUrlWatch();
    }
} // DomWatcher

(globalThis as any).DomWatcher = DomWatcher;
