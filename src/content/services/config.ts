/**
 * Loads, persists, and broadcasts user configuration state for the content script.
 */
class ConfigService {
    private loaded = false;
    private listeners = new Set<(cfg: typeof contentDefaultConfig) => void>();

    constructor(private storage: StorageService, private readonly scheduler: RenderScheduler) { }

    /**
     * Loads config from storage (once) and returns the in-memory snapshot.
     */
    async load(): Promise<typeof contentDefaultConfig> {
        if (this.loaded) return config;
        const store = await this.storage.read([CONTENT_CONFIG_STORAGE_KEY]);
        this.apply(store[CONTENT_CONFIG_STORAGE_KEY]);
        this.loaded = true;
        return config;
    }

    /**
     * Applies a partial config update and refreshes dependent services.
     */
    apply(obj?: Partial<typeof contentDefaultConfig>) {
        config = { ...contentDefaultConfig, ...(obj || {}) };
        this.enforceState();
        this.notify();
        focusController.syncMode();
        this.scheduler.request();
    }

    /**
     * Writes a config patch to storage and applies it locally.
     */
    async update(partial: Partial<typeof contentDefaultConfig>) {
        const next = { ...config, ...partial };
        await this.storage.write({ [CONTENT_CONFIG_STORAGE_KEY]: next });
        this.apply(next);
    }

    /**
     * Registers a listener for config change events.
     */
    onChange(listener: (cfg: typeof contentDefaultConfig) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /**
     * Returns true when search UI should be available.
     */
    isSearchEnabled() {
        return !!config.searchEnabled;
    }

    /**
     * Returns true when tagging UI should be available.
     */
    areTagsEnabled() {
        return !!config.tagsEnabled;
    }

    /**
     * Returns true if search UI is allowed to expand on hover.
     */
    doesSearchExpand() {
        return this.isSearchEnabled() && !!config.searchExpands;
    }

    /**
     * Returns true if the tag panel is allowed to expand on hover.
     */
    doTagsExpand() {
        return this.areTagsEnabled() && !!config.tagsExpands;
    }

    /**
     * Returns true when overview ruler UI should be rendered.
     */
    isOverviewEnabled() {
        return !!config.overviewEnabled;
    }

    /**
     * Returns true if the overview ruler can expand on hover.
     */
    doesOverviewExpand() {
        return !!config.overviewExpands;
    }

    /**
     * Notifies subscribed listeners about a config change.
     */
    private notify() {
        this.listeners.forEach(listener => listener(config));
    }

    /**
     * Ensures derived state (focus mode/tag selection) stays valid when config disables features.
     */
    private enforceState() {
        let changed = false;
        if (!this.isSearchEnabled()) {
            focusService.setSearchQuery('');
            topPanelController.clearSearchInput();
            changed = true;
        }
        if (!this.areTagsEnabled()) {
            focusService.clearTags();
            changed = true;
        }
        if (changed) focusController.syncMode();
    }
} // ConfigService

const CONTENT_CONFIG_STORAGE_KEY = '__tagalyst_config';
const contentDefaultConfig = {
    searchEnabled: true,
    tagsEnabled: true,
    overviewEnabled: true,
    searchExpands: true,
    tagsExpands: true,
    overviewExpands: true,
};
let config = { ...contentDefaultConfig };
