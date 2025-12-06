// @ts-nocheck
import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import { ThreadDom, FocusService, FocusController } from '../test-exports';

// Load toolbar controller via compiled script (attaches to global).
const stubGlobals = () => {
    (globalThis as any).topPanelController = { syncWidth: () => undefined };
    (globalThis as any).exportController = { copyThread: jest.fn() };
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
        toggleAll: jest.fn(),
        collapseByFocus: jest.fn(),
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
        (globalThis as any).exportController.copyThread = jest.fn();
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

    it('keeps message buttons working even if transcript root lookup fails', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const deps = makeDeps();
        deps.threadDom.findTranscriptRoot = () => null as any;
        const msg = buildMessage('m2');
        container.appendChild(msg);
        deps.toolbar.injectToolbar(msg, 'thread-2');
        const collapseBtn = msg.querySelector<HTMLButtonElement>('.ext-collapse');
        collapseBtn?.click();
        expect(deps.threadActions.collapse).toHaveBeenCalled();
    });

    it('renders nav controls in order and wires listeners', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const deps = makeDeps();
        // Fake navigation targets
        const nodeA = document.createElement('div');
        nodeA.scrollIntoView = jest.fn();
        const nodeB = document.createElement('div');
        nodeB.scrollIntoView = jest.fn();
        deps.threadDom.getNavigationNodes = jest.fn().mockReturnValue([nodeA, nodeB]);

        const scrollSpy = jest.spyOn(deps.toolbar as any, 'scrollToNode');
        deps.toolbar.ensurePageControls(container, 'thread-xyz');

        const ids = Array.from(document.querySelectorAll<HTMLButtonElement>('#ext-page-controls button')).map(btn => btn.id);
        expect(new Set(ids)).toEqual(new Set([
            'ext-jump-first',
            'ext-jump-last',
            'ext-jump-star-prev',
            'ext-jump-star-next',
            'ext-collapse-all',
            'ext-collapse-unstarred',
            'ext-expand-all',
            'ext-expand-starred',
            'ext-export-all',
            'ext-export-starred',
        ]));

        (document.getElementById('ext-jump-first') as HTMLButtonElement)?.click();
        (document.getElementById('ext-jump-last') as HTMLButtonElement)?.click();
        expect(scrollSpy).toHaveBeenCalledWith(container, 0, 'start');
        expect(scrollSpy).toHaveBeenCalledWith(container, 1, 'end', [nodeA, nodeB]);

        (document.getElementById('ext-collapse-all') as HTMLButtonElement)?.click();
        (document.getElementById('ext-collapse-unstarred') as HTMLButtonElement)?.click();
        expect(deps.threadActions.toggleAll).toHaveBeenCalledWith(container, true);
        expect(deps.threadActions.collapseByFocus).toHaveBeenCalledWith(container, 'out', true);

        (document.getElementById('ext-expand-all') as HTMLButtonElement)?.click();
        (document.getElementById('ext-expand-starred') as HTMLButtonElement)?.click();
        expect(deps.threadActions.toggleAll).toHaveBeenCalledWith(container, false);
        expect(deps.threadActions.collapseByFocus).toHaveBeenCalledWith(container, 'in', false);

        (document.getElementById('ext-export-all') as HTMLButtonElement)?.click();
        (document.getElementById('ext-export-starred') as HTMLButtonElement)?.click();
        expect((globalThis as any).exportController.copyThread).toHaveBeenCalledWith(container, false);
        expect((globalThis as any).exportController.copyThread).toHaveBeenCalledWith(container, true);
    });
});
