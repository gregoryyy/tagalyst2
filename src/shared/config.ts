/**
 * Shared config defaults and storage key for Tagalyst.
 * Kept global (no imports) so both content and options scripts can consume the same values.
 */
export const TAGALYST_CONFIG_STORAGE_KEY = '__tagalyst_config';

export const TAGALYST_DEFAULT_CONFIG = {
    searchEnabled: true,
    tagsEnabled: true,
    overviewEnabled: true,
    searchExpands: true,
    tagsExpands: true,
    overviewExpands: true,
};

export type TagalystConfig = typeof TAGALYST_DEFAULT_CONFIG;

(globalThis as any).TAGALYST_CONFIG_STORAGE_KEY = TAGALYST_CONFIG_STORAGE_KEY;
(globalThis as any).TAGALYST_DEFAULT_CONFIG = TAGALYST_DEFAULT_CONFIG;
