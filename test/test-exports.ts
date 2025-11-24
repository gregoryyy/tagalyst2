// Side-effect imports to register globals.
require('../src/shared/config');
require('../src/shared/storage');
require('../src/content/constants');
require('../src/content/utils');
require('../src/content/dom/message-adapters');
require('../src/content/dom/thread-dom');
require('../src/content/dom/chatgpt-adapter');
require('../src/content/adapters/registry');
require('../src/content/adapters/api-shim');
require('../src/content/adapters/fakes');
require('../src/content/services/render-scheduler');
require('../src/content/services/thread-metadata');
require('../src/content/services/transcript');
require('../src/content/services/thread-renderer');
require('../src/content/services/dom-watcher');
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
export const DomMessageAdapter = globals.DomMessageAdapter;
export const DomPairAdapter = globals.DomPairAdapter;
export const ThreadDom = globals.ThreadDom;
export const ChatGptThreadAdapter = globals.ChatGptThreadAdapter;
export const ThreadAdapterRegistry = globals.ThreadAdapterRegistry;
export const TranscriptService = globals.TranscriptService;
export const ApiThreadAdapter = globals.ApiThreadAdapter;
export const DomWatcher = globals.DomWatcher;
export const FakeThreadAdapter = globals.FakeThreadAdapter;
export const FakeMessageAdapter = globals.FakeMessageAdapter;
export const ThreadRenderService = globals.ThreadRenderService;
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
