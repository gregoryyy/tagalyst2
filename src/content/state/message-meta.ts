type MessageMeta = {
    key: string | null;
    value: MessageValue;
    pairIndex: number | null;
    adapter: MessageAdapter | null;
};


/**
 * Tracks metadata for DOM message elements such as storage keys, values, and adapters.
 */
class MessageMetaRegistry {
    private readonly store = new Map<HTMLElement, MessageMeta>();

    /**
     * Clears all cached metadata entries.
     */
    clear() {
        this.store.clear();
    }

    /**
     * Retrieves the metadata record for a given element, if any.
     */
    get(el: HTMLElement) {
        return this.store.get(el) || null;
    }

    /**
     * Deletes the metadata record for a given element.
     */
    delete(el: HTMLElement) {
        this.store.delete(el);
    }

    /**
     * Iterates over all metadata entries.
     */
    forEach(cb: (meta: MessageMeta, el: HTMLElement) => void) {
        this.store.forEach(cb);
    }

    /**
     * Ensures a metadata record exists for the element and optionally seeds key/adapter.
     */
    ensure(el: HTMLElement, key?: string | null, adapter?: MessageAdapter | null) {
        let meta = this.store.get(el);
        if (!meta) {
            meta = { key: key || null, value: {}, pairIndex: null, adapter: adapter || null };
            this.store.set(el, meta);
        }
        if (key) meta.key = key;
        if (adapter) meta.adapter = adapter;
        return meta;
    }

    /**
     * Updates portions of a metadata record in place.
     */
    update(el: HTMLElement, opts: { key?: string | null; value?: MessageValue; pairIndex?: number | null; adapter?: MessageAdapter | null } = {}) {
        const meta = this.ensure(el, opts.key ?? null, opts.adapter ?? null);
        if (typeof opts.pairIndex === 'number') {
            meta.pairIndex = opts.pairIndex;
        } else if (opts.pairIndex === null) {
            meta.pairIndex = null;
        }
        if (opts.value) meta.value = opts.value;
        return meta;
    }

    /**
     * Resolves (or creates) a DomMessageAdapter for the element.
     */
    resolveAdapter(el: HTMLElement): MessageAdapter {
        const meta = this.ensure(el);
        if (meta.adapter && meta.adapter.element === el) {
            return meta.adapter;
        }
        const adapter = new DomMessageAdapter(el);
        meta.adapter = adapter;
        return adapter;
    }

    /**
     * Returns the internal metadata map. Consumers must handle stale nodes.
     */
    getStore() {
        return this.store;
    }
} // MessageMetaRegistry

