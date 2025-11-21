import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import { FocusController, FOCUS_MODES } from '../../src/content/state/focus.export';

class StubFocus {
    mode = FOCUS_MODES.STARS;
    syncMode = jest.fn();
    getMode = () => this.mode;
    getModeLabel = () => 'starred message';
    getGlyph = (filled: boolean) => (filled ? '★' : '☆');
    describeMode = () => 'starred items';
    getMatches = jest.fn().mockReturnValue([]);
}

const stubMessages = {
    forEach: jest.fn(),
    delete: jest.fn(),
    clear: jest.fn(),
    get: jest.fn().mockReturnValue(null),
};

describe('FocusController', () => {
    beforeEach(() => {
        stubMessages.forEach.mockImplementation(() => undefined);
        stubMessages.delete.mockClear();
    });

    it('calls focus.syncMode and selectionSync during syncMode', () => {
        const focus = new StubFocus();
        const controller = new FocusController(focus as any, stubMessages as any);
        const selectionSpy = jest.fn();
        controller.attachSelectionSync(selectionSpy);
        controller.syncMode();
        expect(focus.syncMode).toHaveBeenCalled();
        expect(selectionSpy).toHaveBeenCalled();
    });

    it('updates page controls based on mode glyphs', () => {
        const focus = new StubFocus();
        const controller = new FocusController(focus as any, stubMessages as any);
        const prev = document.createElement('button');
        const next = document.createElement('button');
        const collapse = document.createElement('button');
        const expand = document.createElement('button');
        const exportBtn = document.createElement('button');
        controller.setPageControls({
            focusPrev: prev,
            focusNext: next,
            collapseNonFocus: collapse,
            expandFocus: expand,
            exportFocus: exportBtn,
            root: document.createElement('div'),
        } as any);
        controller.updateControlsUI();
        expect(prev.textContent).toContain('☆');
        expect(next.textContent).toContain('☆');
        expect(collapse.textContent).toBe('☆');
        expect(expand.textContent).toBe('★');
        expect(exportBtn.textContent).toBe('★');
    });
});
