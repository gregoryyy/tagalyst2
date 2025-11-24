/**
 * Debounces render work via requestAnimationFrame to avoid redundant passes.
 */
class RenderScheduler {
    private rafId: number | null = null;
    private renderer: (() => Promise<void>) | null = null;
    private inflight = false;

    /**
     * Sets the current renderer callback.
     */
    setRenderer(renderer: () => Promise<void>) {
        this.renderer = renderer;
    }

    /**
     * Requests a render tick, optionally swapping the renderer.
     */
    request(renderer?: () => Promise<void>) {
        if (renderer) this.renderer = renderer;
        const target = renderer ?? this.renderer;
        if (!target) return;
        if (this.rafId) cancelAnimationFrame(this.rafId);
        this.rafId = requestAnimationFrame(() => {
            this.rafId = null;
            const start = performance.now();
            if (this.inflight) {
                // eslint-disable-next-line no-console
                console.warn('RenderScheduler: renderer re-entered, dropping this tick');
                return;
            }
            this.inflight = true;
            try {
                const res = target();
                if (res && typeof (res as any).then === 'function') {
                    (res as Promise<void>).catch(err => {
                        // eslint-disable-next-line no-console
                        console.error('RenderScheduler error', err);
                    }).finally(() => this.finish(start));
                } else {
                    this.finish(start);
                }
            } catch (err) {
                // eslint-disable-next-line no-console
                console.error('RenderScheduler error', err);
                this.finish(start);
            }
        });
    }

    private finish(start: number) {
        this.inflight = false;
        const duration = performance.now() - start;
        if (duration > 16) {
            // eslint-disable-next-line no-console
            console.warn(`RenderScheduler: slow render ${duration.toFixed(1)}ms`);
        }
    }
} // RenderScheduler

// Expose globally for tests/debug helpers.
(globalThis as any).RenderScheduler = RenderScheduler;
