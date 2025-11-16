/**
 * Debounces render work via requestAnimationFrame to avoid redundant passes.
 */
class RenderScheduler {
    constructor() {
        this.rafId = null;
        this.renderer = null;
    }
    /**
     * Sets the current renderer callback.
     */
    setRenderer(renderer) {
        this.renderer = renderer;
    }
    /**
     * Requests a render tick, optionally swapping the renderer.
     */
    request(renderer) {
        if (renderer)
            this.renderer = renderer;
        const target = renderer ?? this.renderer;
        if (!target)
            return;
        if (this.rafId)
            cancelAnimationFrame(this.rafId);
        this.rafId = requestAnimationFrame(() => {
            this.rafId = null;
            target();
        });
    }
} // RenderScheduler
