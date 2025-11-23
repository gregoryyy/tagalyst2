/// <reference path="./config.ts" />
/// <reference path="./storage.ts" />

/**
 * Single attachment point for shared globals used across content/options.
 */
(() => {
    const g = globalThis as any;
    if (typeof TAGALYST_CONFIG_STORAGE_KEY !== 'undefined') {
        g.TAGALYST_CONFIG_STORAGE_KEY = TAGALYST_CONFIG_STORAGE_KEY;
    }
    if (typeof TAGALYST_DEFAULT_CONFIG !== 'undefined') {
        g.TAGALYST_DEFAULT_CONFIG = TAGALYST_DEFAULT_CONFIG;
    }
    if (typeof tagalystStorage !== 'undefined') {
        g.tagalystStorage = tagalystStorage;
    }
})();
