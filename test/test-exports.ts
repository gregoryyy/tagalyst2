// Side-effect imports to register globals.
import '../src/content/constants';
import '../src/content/utils';
import '../src/content/services/render-scheduler';
import '../src/content/state/focus';
import '../src/content/controllers/top-panel';

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
