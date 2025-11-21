/**
 * Shared config defaults and storage key for Tagalyst.
 * Kept global (no imports) so both content and options scripts can consume the same values.
 */
const TAGALYST_CONFIG_STORAGE_KEY = '__tagalyst_config';

const TAGALYST_DEFAULT_CONFIG = {
    searchEnabled: true,
    tagsEnabled: true,
    overviewEnabled: true,
    searchExpands: true,
    tagsExpands: true,
    overviewExpands: true,
};

type TagalystConfig = typeof TAGALYST_DEFAULT_CONFIG;
