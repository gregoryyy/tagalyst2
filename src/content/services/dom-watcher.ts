/// <reference path="../utils.ts" />
/// <reference path="../../types/globals.d.ts" />

type DomWatcherHandlers = {
    onMutations: () => void;
    onNav: () => void;
    onRootChange?: (next: HTMLElement | null) => void;
};

/**
 * Centralizes DOM/URL watching and emits normalized events for render orchestration.
 */
class DomWatcher {
    private mutationObserver: MutationObserver | null = null;
    private lastHref: string = location.href;
    private urlTimer: number | null = null;
    private currentRoot: HTMLElement | null = null;

    constructor(private readonly handlers: DomWatcherHandlers) { }

    /**
     * Begins observing transcript container mutations.
     */
    watchContainer(container: HTMLElement | null) {
        this.stopMutationObserver();
        if (this.currentRoot !== container) {
            this.currentRoot = container;
            this.handlers.onRootChange?.(container);
        }
        if (!container) return;
        this.mutationObserver = new MutationObserver(records => {
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
        this.urlTimer = window.setInterval(() => {
            if (location.href !== this.lastHref) {
                this.lastHref = location.href;
                this.handlers.onNav();
            }
        }, 800);
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
    }

    teardown() {
        this.stopMutationObserver();
        this.stopUrlWatch();
    }
} // DomWatcher

(globalThis as any).DomWatcher = DomWatcher;
