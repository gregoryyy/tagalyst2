/**
 * Grab bag of DOM-safe utilities used throughout the content script.
 */
namespace Utils {
    
    /**
     * Small helper for delaying async flows without blocking the UI thread.
     */
    export function sleep(ms: number) {
        return new Promise<void>(resolve => setTimeout(resolve, ms));
    }

    /**
     * Produces a deterministic 32-bit FNV-1a hash for lightweight keys.
     */
    export function hashString(s: string) {
        let h = 0x811c9dc5;
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
        }
        return ("0000000" + h.toString(16)).slice(-8);
    }

    export function normalizeText(t: string) {
        return (t || "")
            .replace(/\s+/g, " ")
            .replace(/[\u200B-\u200D\uFEFF]/g, "")
            .trim();
    }

    export function placeCaretAtEnd(el: HTMLElement) {
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = window.getSelection();
        if (!sel) return;
        sel.removeAllRanges();
        sel.addRange(range);
    }

    export function mountFloatingEditor(editor: HTMLElement, anchor: HTMLElement): () => void {
        editor.classList.add('ext-floating-editor');
        markExtNode(editor);
        document.body.appendChild(editor);

        const clamp = (val: number, min: number, max: number) => Math.min(Math.max(val, min), max);

        const update = () => {
            const rect = anchor.getBoundingClientRect();
            const width = Math.min(420, window.innerWidth - 32);
            editor.style.width = `${width}px`;
            const baseTop = window.scrollY + rect.top + 16;
            const maxTop = window.scrollY + window.innerHeight - editor.offsetHeight - 16;
            const top = clamp(baseTop, window.scrollY + 16, maxTop);
            const baseLeft = window.scrollX + rect.right - width;
            const minLeft = window.scrollX + 16;
            const maxLeft = window.scrollX + window.innerWidth - width - 16;
            const left = clamp(baseLeft, minLeft, maxLeft);
            editor.style.top = `${top}px`;
            editor.style.left = `${left}px`;
        };

        const onScroll = () => update();
        const onResize = () => update();

        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onResize);
        update();

        return () => {
            window.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', onResize);
            editor.classList.remove('ext-floating-editor');
        };
    }

    /**
     * Generates a thread-level key using the conversation ID when available.
     */
    export function getThreadKey(): string {
        try {
            const u = new URL(location.href);
            if (u.pathname && u.pathname.length > 1) return u.pathname.replace(/\W+/g, "-");
        } catch { /* noop */ }
        return hashString(document.title + location.host);
    }

    /**
     * Returns the DOM-provided message UUID if available.
     */
    export function getMessageId(el: Element | null) {
        return el?.getAttribute?.('data-message-id') || null;
    }

    /**
     * Stable-ish per-message key derived from ChatGPT IDs or fallback heuristics.
     */
    export function keyForMessage(el: HTMLElement) {
        const domId = getMessageId(el);
        if (domId) return domId;
        const text = normalizeText(el.innerText).slice(0, 4000); // perf cap
        const idx = Array.prototype.indexOf.call(el.parentElement?.children || [], el);
        return hashString(text + "|" + idx);
    }

    /**
     * Flags a DOM node as extension-managed so MutationObservers can ignore it.
     */
    export function markExtNode(el: Element | null) {
        if (el?.setAttribute) {
            el.setAttribute(EXT_ATTR, '1');
        }
    }

    /**
     * Walks up from the provided node to see if any ancestor belongs to the extension.
     */
    export function closestExtNode(node: Node | null) {
        if (!node) return null;
        if (node.nodeType === Node.ELEMENT_NODE && typeof (node as Element).closest === 'function') {
            return (node as Element).closest(`[${EXT_ATTR}]`);
        }
        const parent = node.parentElement;
        if (parent && typeof parent.closest === 'function') {
            return parent.closest(`[${EXT_ATTR}]`);
        }
        return null;
    }

    /**
     * Returns true when the supplied node is part of extension-owned UI.
     */
    export function isExtensionNode(node: Node | null) {
        return !!closestExtNode(node);
    }

    /**
     * Determines whether a mutation record affects host content rather than extension nodes.
     */
    export function mutationTouchesExternal(record: MutationRecord) {
        if (!isExtensionNode(record.target)) return true;
        for (const node of record.addedNodes) {
            if (!isExtensionNode(node)) return true;
        }
        for (const node of record.removedNodes) {
            if (!isExtensionNode(node)) return true;
        }
        return false;
    }
} // Utils
