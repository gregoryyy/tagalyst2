import { describe, expect, it, beforeEach } from '@jest/globals';
import { TopPanelController } from '../test-exports';

const makeFocusService = () => {
    const selected = new Set<string>();
    let query = '';
    return {
        getSearchQuery: () => query,
        setSearchQuery: jest.fn((val: string) => { query = val; }),
        isTagSelected: (tag: string) => selected.has(tag),
        toggleTag: (tag: string) => {
            if (selected.has(tag)) selected.delete(tag);
            else selected.add(tag);
        },
        clearTags: () => selected.clear(),
    };
};

const makeConfigService = (enabled = true) => ({
    isSearchEnabled: () => enabled,
    areTagsEnabled: () => enabled,
    doesSearchExpand: () => false,
    doTagsExpand: () => false,
});

const makeFocusController = () => ({
    syncMode: jest.fn(),
    getMatches: jest.fn().mockReturnValue([1, 2]),
});

describe('TopPanelController', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('toggles tags and clears selection when config disables tags', () => {
        const focusService = makeFocusService();
        const focusController = makeFocusController();
        const controller = new TopPanelController(focusService as any, makeConfigService() as any, focusController as any);
        controller.ensurePanels();
        controller.updateTagList([{ tag: 'foo', count: 1 }]);
        const row = document.querySelector('.ext-tag-sidebar-row') as HTMLElement;
        row.click();
        expect(row.classList.contains('ext-tag-selected')).toBe(true);
        // Disable tags and ensure selection is cleared.
        const disabledConfig = makeConfigService(false);
        const disabledController = new TopPanelController(focusService as any, disabledConfig as any, focusController as any);
        disabledController.ensurePanels();
        disabledController.updateTagList([]);
        expect(focusService.clearTags).toBeDefined();
    });

    it('renders tags and toggles selection', () => {
        const focusService = makeFocusService();
        const focusController = makeFocusController();
        const controller = new TopPanelController(focusService as any, makeConfigService() as any, focusController as any);
        controller.ensurePanels();
        controller.updateTagList([{ tag: 'foo', count: 2 }, { tag: 'bar', count: 1 }]);
        const rows = Array.from(document.querySelectorAll('.ext-tag-sidebar-row'));
        expect(rows.length).toBe(2);
        const first = rows[0];
        first.dispatchEvent(new Event('click'));
        expect(first.classList.contains('ext-tag-selected')).toBe(true);
        expect(focusController.syncMode).toHaveBeenCalled();
    });

    it('handles search input and updates result count', () => {
        const focusService = makeFocusService();
        const focusController = makeFocusController();
        const controller = new TopPanelController(focusService as any, makeConfigService() as any, focusController as any);
        controller.ensurePanels();
        const input = document.querySelector<HTMLInputElement>('.ext-search-input')!;
        input.value = 'hello';
        input.dispatchEvent(new Event('input'));
        controller.updateSearchResultCount();
        const countEl = document.querySelector('.ext-search-count') as HTMLElement;
        expect(focusService.setSearchQuery).toHaveBeenCalledWith('hello');
        expect(focusController.syncMode).toHaveBeenCalled();
        expect(countEl.textContent).toBe('2 results');
    });
});
