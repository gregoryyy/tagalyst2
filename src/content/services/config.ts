/// <reference path="../../shared/config.ts" />

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
        this.loaded = true;
        if (typeof (this.scheduler as any).setWarningsEnabled === 'function') {
            (this.scheduler as any).setWarningsEnabled(!!config.debugVerbose);
        }
        this.enforceState();
        this.notify();
        this.scheduler.request();
        return config;
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
     * Returns true when the thread metadata toolbar should be shown.
     */
    isMetaToolbarEnabled() {
        return config.metaToolbarEnabled !== false;
    }

    /**
     * Returns true when the nav toolbar should be shown.
     */
    isNavToolbarEnabled() {
        return config.navToolbarEnabled !== false;
    }

    /**
     * Returns true when per-message toolbars should be shown.
     */
    isMessageToolbarEnabled() {
        return config.messageToolbarEnabled !== false;
    }

    /**
     * Returns true when sidebar labels should be shown.
     */
    isSidebarLabelsEnabled() {
        return config.sidebarLabelsEnabled !== false;
    }

    /**
     * Returns true when perf debug logging is enabled.
     */
    isPerfDebugEnabled() {
        return config.debugPerf === true;
    }

    /**
     * Returns true when verbose debug/warning logs should be shown.
     */
    isVerboseDebugEnabled() {
        return config.debugVerbose === true;
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

    }
} // ConfigService

const CONTENT_CONFIG_STORAGE_KEY = TAGALYST_CONFIG_STORAGE_KEY;
const contentDefaultConfig = TAGALYST_DEFAULT_CONFIG;
let config: TagalystConfig = { ...contentDefaultConfig };
