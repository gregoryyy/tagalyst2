// @ts-nocheck
import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import { ThreadDom, FocusService, FocusController } from '../test-exports';

// Load toolbar controller via compiled script (attaches to global).
const stubGlobals = () => {
    (globalThis as any).topPanelController = { syncWidth: () => undefined };
    (globalThis as any).exportController = { copyThread: () => undefined };
    (globalThis as any).messageMetaRegistry = {
        resolveAdapter: (el: HTMLElement) => ({ element: el, getText: () => el.textContent || '', key: el.getAttribute('data-message-id') || 'k' }),
        update: (_el: HTMLElement, meta: any) => meta,
    };
    (globalThis as any).focusController = {
        setPageControls: () => undefined,
        getMatches: () => [],
        updateControlsUI: () => undefined,
        updateMessageButton: () => undefined,
    };
    (globalThis as any).focusService = {
        getMode: () => 'stars',
    };
};
stubGlobals();
require('../../content/content/controllers/toolbar.js');
const ToolbarController = (globalThis as any).ToolbarController as any;

const buildMessage = (id: string) => {
    const msg = document.createElement('div');
    msg.className = 'message';
    msg.setAttribute('data-message-id', id);
    msg.getBoundingClientRect = () => ({ top: 0, left: 0, width: 100, height: 20, bottom: 20, right: 100 } as any);
    document.body.appendChild(msg);
    return msg;
};

const makeDeps = () => {
    const threadDom = new ThreadDom(() => null as any);
    const storageService: any = { readMessage: jest.fn().mockResolvedValue({}), writeMessage: jest.fn() };
    const editorController: any = { openTagEditor: jest.fn(), openNoteEditor: jest.fn() };
    const threadActions: any = {
        collapse: jest.fn(),
        updateCollapseVisibility: jest.fn(),
        syncCollapseButton: jest.fn(),
    };
    const highlightController: any = { applyHighlights: jest.fn() };
    const overview: any = { refreshMarkers: jest.fn() };
    const focusService = new FocusService({ isSearchEnabled: () => true, areTagsEnabled: () => true } as any);
    const focusController = new FocusController(focusService as any, { update: () => undefined } as any);
    focusController.updateControlsUI = jest.fn();
    focusController.updateMessageButton = jest.fn();

    return {
        toolbar: new ToolbarController({
            focusService,
            focusController,
            storageService,
            editorController,
            threadDom,
            threadActions,
            highlightController,
            overviewRulerController: overview,
        } as any),
        threadDom,
        storageService,
        editorController,
        threadActions,
        highlightController,
        overview,
        focusController,
    };
};

describe('Toolbar reactivity', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        (globalThis as any).__tagalystDebugToolbar = false;
    });

    it('mounts page controls once when toggled on/off', () => {
        const container = document.createElement('div');
        container.id = 'thread-root';
        document.body.appendChild(container);
    const deps = makeDeps();
        deps.toolbar.ensurePageControls(container, 'thread-1');
        deps.toolbar.ensurePageControls(container, 'thread-1'); // should reuse
        expect(document.querySelectorAll('#ext-page-controls').length).toBe(1);
        document.getElementById('ext-page-controls')?.remove();
        deps.toolbar.ensurePageControls(container, 'thread-1');
        expect(document.querySelectorAll('#ext-page-controls').length).toBe(1);
    });

    it('injects toolbars without duplicates and keeps buttons responsive across renders', async () => {
        const container = document.createElement('div');
        container.id = 'thread-root';
        document.body.appendChild(container);
        const deps = makeDeps();
        const msg = buildMessage('m1');
        container.appendChild(msg);

        deps.toolbar.injectToolbar(msg, 'thread-1');
        deps.toolbar.injectToolbar(msg, 'thread-1');
        expect(msg.querySelectorAll('.ext-toolbar').length).toBe(1);
        expect(msg.querySelectorAll('.ext-toolbar-row').length).toBe(1);

        const focusBtn = msg.querySelector<HTMLButtonElement>('.ext-focus-button');
        expect(focusBtn).not.toBeNull();
        await focusBtn?.onclick?.(new Event('click') as any);
        await focusBtn?.onclick?.(new Event('click') as any);
        expect(deps.storageService.writeMessage).toHaveBeenCalled();
    });
});
