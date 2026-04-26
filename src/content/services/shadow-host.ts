/// <reference path="../utils.ts" />

/**
 * Owns a single shadow root that hosts the body-mounted overlay UIs
 * (page controls, top panel, overview ruler, floating editors). Isolates
 * those UIs from the host page's CSS so ChatGPT redesigns don't bleed in.
 *
 * Falls back to mounting in `document.body` when running outside an
 * extension context (tests, devtools harness).
 */
class ShadowHostService {
    private host: HTMLElement | null = null;
    private root: ShadowRoot | null = null;
    private booted = false;
    private styleLoaded = false;

    /**
     * Idempotently creates the shadow host and adopts the extension stylesheet.
     */
    boot() {
        if (this.booted) return;
        this.booted = true;
        const runtime = (typeof chrome !== 'undefined') ? (chrome as any).runtime : null;
        if (!runtime?.getURL) return; // light-DOM fallback for tests/non-extension
        const parent = document.documentElement || document.body;
        if (!parent) return;
        const host = document.createElement('div');
        host.id = 'tagalyst-overlay-host';
        Utils.markExtNode(host);
        // Zero-size fixed host: serves as a positioning origin without
        // intercepting pointer events or shifting layout.
        host.style.cssText = 'position: fixed; top: 0; left: 0; width: 0; height: 0; pointer-events: none; z-index: 2147483646;';
        parent.appendChild(host);
        const root = host.attachShadow({ mode: 'open' });
        this.host = host;
        this.root = root;
        this.loadStylesheet(runtime);
    }

    private loadStylesheet(runtime: any) {
        if (this.styleLoaded || !this.root) return;
        try {
            const url = runtime.getURL('content/content.css');
            fetch(url)
                .then(r => r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))
                .then(text => this.applyStylesheet(text))
                .catch(err => console.error('[tagalyst] shadow stylesheet load failed', err));
        } catch (err) {
            console.error('[tagalyst] shadow boot', err);
        }
    }

    private applyStylesheet(text: string) {
        if (!this.root || this.styleLoaded) return;
        try {
            if (typeof CSSStyleSheet !== 'undefined' && 'replaceSync' in CSSStyleSheet.prototype) {
                const sheet = new CSSStyleSheet();
                sheet.replaceSync(text);
                (this.root as any).adoptedStyleSheets = [sheet];
            } else {
                const style = document.createElement('style');
                style.textContent = text;
                this.root.appendChild(style);
            }
            this.styleLoaded = true;
        } catch (err) {
            console.error('[tagalyst] shadow stylesheet apply', err);
        }
    }

    /**
     * Returns the live mount target. In extension context this is the shadow
     * root; in tests/non-extension contexts it falls back to document.body.
     */
    getMountTarget(): ShadowRoot | HTMLElement {
        if (this.root) return this.root;
        return document.body;
    }

    /**
     * Appends a node to the mount target.
     */
    append(node: Node) {
        this.getMountTarget().appendChild(node);
    }

    /**
     * Resolves an element by id from the shadow root, falling back to document.
     */
    getById(id: string): HTMLElement | null {
        if (this.root) {
            const found = (this.root as unknown as DocumentFragment).getElementById?.(id) || null;
            if (found) return found as HTMLElement;
        }
        return document.getElementById(id);
    }

    /**
     * Resolves the first matching element in the shadow root, then document.
     */
    querySelector<T extends HTMLElement = HTMLElement>(selector: string): T | null {
        if (this.root) {
            const found = this.root.querySelector<T>(selector);
            if (found) return found;
        }
        return document.querySelector<T>(selector);
    }

    /**
     * Removes a previously mounted node by id from wherever it lives.
     */
    removeById(id: string) {
        this.getById(id)?.remove();
    }

    /**
     * Returns the shadow root if active, else null.
     */
    getRoot(): ShadowRoot | null {
        return this.root;
    }
} // ShadowHostService

(globalThis as any).ShadowHostService = ShadowHostService;
if (!(globalThis as any).shadowHostService) {
    (globalThis as any).shadowHostService = new ShadowHostService();
}
declare const shadowHostService: ShadowHostService;
