// @ts-nocheck
import { describe, expect, it, beforeEach, jest } from '@jest/globals';

require('../test-exports');
require('../../content/content/controllers/toolbar.js');

const ToolbarController = (globalThis as any).ToolbarController as any;
// Stub globals used inside ToolbarController
(globalThis as any).topPanelController = { syncWidth: () => undefined };
(globalThis as any).focusController = {
    setPageControls: () => undefined,
    getMatches: () => [],
    updateControlsUI: () => undefined,
};

describe('Toolbar slow-load resilience', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        (globalThis as any).__tagalystDebugToolbar = false;
    });

    it('mounts page controls once when injected after delay', async () => {
        const container = document.createElement('div');
        container.id = 'thread-root';
        document.body.appendChild(container);
        const threadDom = { findTranscriptRoot: () => container, getNavigationNodes: () => [] } as any;
        const toolbar = new ToolbarController({
            focusService: {} as any,
            focusController: { setPageControls: jest.fn(), getMatches: () => [] } as any,
            storageService: {} as any,
            editorController: {} as any,
            threadDom,
            threadActions: { collapse: jest.fn(), updateCollapseVisibility: jest.fn(), syncCollapseButton: jest.fn() } as any,
            highlightController: {} as any,
            overviewRulerController: { refreshMarkers: jest.fn() } as any,
        } as any);
        toolbar.ensurePageControls(container, 'thread-1');
        // Simulate late second ensure after slow load
        await new Promise(res => setTimeout(res, 10));
        toolbar.ensurePageControls(container, 'thread-1');
        const controls = document.querySelectorAll('#ext-page-controls');
        expect(controls.length).toBe(1);
    });
});
