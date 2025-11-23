/**
 * Debounces render work via requestAnimationFrame to avoid redundant passes.
 */
class RenderScheduler {
    private rafId: number | null = null;
    private renderer: (() => Promise<void>) | null = null;

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
            target();
        });
    }
} // RenderScheduler

// Expose globally for tests/debug helpers.
(globalThis as any).RenderScheduler = RenderScheduler;
