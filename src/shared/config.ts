/**
 * Shared config defaults and storage key for Tagalyst.
 * Script-style globals so content/options can consume them without modules.
 */
const TAGALYST_CONFIG_STORAGE_KEY = '__tagalyst_config';

const TAGALYST_DEFAULT_CONFIG = {
    searchEnabled: true,
    tagsEnabled: true,
    overviewEnabled: true,
    searchExpands: true,
    tagsExpands: true,
    overviewExpands: true,
    metaToolbarEnabled: true,
    sidebarLabelsEnabled: true,
    navToolbarEnabled: true,
};

type TagalystConfig = typeof TAGALYST_DEFAULT_CONFIG;

(globalThis as any).TAGALYST_CONFIG_STORAGE_KEY = TAGALYST_CONFIG_STORAGE_KEY;
(globalThis as any).TAGALYST_DEFAULT_CONFIG = TAGALYST_DEFAULT_CONFIG;
