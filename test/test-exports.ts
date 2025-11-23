// Side-effect imports to register globals.
require('../src/shared/config');
require('../src/shared/storage');
require('../src/content/constants');
require('../src/content/utils');
require('../src/content/services/render-scheduler');
require('../src/content/services/thread-metadata');
require('../src/content/controllers/thread-metadata');
require('../src/content/state/focus');
require('../src/content/controllers/top-panel');
require('../src/content/controllers/keyboard');
require('../src/content/controllers/sidebar-labels');
require('../src/content/controllers/project-list-labels');
require('../src/shared/globals');
require('../src/content/globals');

// Extract from globals set by the modules.
const globals = globalThis as any;

export const Utils = globals.Utils;
export const EXT_ATTR = globals.EXT_ATTR;
export const RenderScheduler = globals.RenderScheduler;
export const FocusService = globals.FocusService;
export const FocusController = globals.FocusController;
export const FOCUS_MODES = globals.FOCUS_MODES;
export const focusMarkerColors = globals.focusMarkerColors;
export const TopPanelController = globals.TopPanelController;
export const TAGALYST_CONFIG_STORAGE_KEY = globals.TAGALYST_CONFIG_STORAGE_KEY;
export const TAGALYST_DEFAULT_CONFIG = globals.TAGALYST_DEFAULT_CONFIG;
export const tagalystStorage = globals.tagalystStorage;
export const ThreadMetadataService = globals.ThreadMetadataService;
export const deriveThreadId = globals.deriveThreadId;
export const ThreadMetadataController = globals.ThreadMetadataController;
export const {
    sleep,
    hashString,
    normalizeText,
    placeCaretAtEnd,
    mountFloatingEditor,
    getThreadKey,
    getMessageId,
    keyForMessage,
    markExtNode,
    closestExtNode,
    isExtensionNode,
    mutationTouchesExternal,
} = globals.Utils || {};
export const SidebarLabelController = globals.SidebarLabelController;
export const ProjectListLabelController = globals.ProjectListLabelController;
