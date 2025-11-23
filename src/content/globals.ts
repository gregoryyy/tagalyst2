/// <reference path="./constants.ts" />
/// <reference path="./utils.ts" />
/// <reference path="./services/thread-metadata.ts" />
/// <reference path="./services/render-scheduler.ts" />
/// <reference path="./state/focus.ts" />
/// <reference path="./controllers/project-list-labels.ts" />
/// <reference path="./controllers/thread-metadata.ts" />
/// <reference path="./controllers/top-panel.ts" />
/// <reference path="./controllers/sidebar-labels.ts" />

/**
 * Centralized global attachments for content scripts.
 */
(() => {
    const g = globalThis as any;
    if (typeof EXT_ATTR !== 'undefined') g.EXT_ATTR = EXT_ATTR;
    if (typeof Utils !== 'undefined') g.Utils = Utils;
    if (typeof ThreadMetadataService !== 'undefined') g.ThreadMetadataService = ThreadMetadataService;
    if (typeof deriveThreadId !== 'undefined') g.deriveThreadId = deriveThreadId;
    if (typeof RenderScheduler !== 'undefined') g.RenderScheduler = RenderScheduler;
    if (typeof FocusService !== 'undefined') g.FocusService = FocusService;
    if (typeof FocusController !== 'undefined') g.FocusController = FocusController;
    if (typeof FOCUS_MODES !== 'undefined') g.FOCUS_MODES = FOCUS_MODES;
    if (typeof focusMarkerColors !== 'undefined') g.focusMarkerColors = focusMarkerColors;
    if (typeof ProjectListLabelController !== 'undefined') g.ProjectListLabelController = ProjectListLabelController;
    if (typeof ThreadMetadataController !== 'undefined') g.ThreadMetadataController = ThreadMetadataController;
    if (typeof TopPanelController !== 'undefined') g.TopPanelController = TopPanelController;
    if (typeof SidebarLabelController !== 'undefined') g.SidebarLabelController = SidebarLabelController;
})();
