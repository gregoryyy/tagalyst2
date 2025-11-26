import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import { TAGALYST_CONFIG_STORAGE_KEY, TAGALYST_DEFAULT_CONFIG } from '../test-exports';
import '../../src/shared/storage';
import '../../src/options';
import chromeMock from '../mocks/chrome';

const buildDom = () => {
    document.body.innerHTML = `
    <main>
        <input type="checkbox" id="search-enable" />
        <input type="checkbox" id="search-expand" />
        <input type="checkbox" id="tags-enable" />
        <input type="checkbox" id="tags-expand" />
        <input type="checkbox" id="overview-enable" />
        <input type="checkbox" id="overview-expand" />
        <span id="status"></span>
        <span id="storage-size"></span>
        <button id="view-storage" type="button">View</button>
        <button id="import-storage" type="button">Import</button>
        <button id="export-storage" type="button">Export</button>
        <button id="clear-storage" type="button">Delete</button>
        <input type="file" id="import-file" />
    </main>
    `;
};

// OptionsController is attached to window in options.ts bootstrap.
const getController = () => (window as any).OptionsController as any;

describe('OptionsController', () => {
    beforeEach(async () => {
        (global as any).chrome = chromeMock;
        chromeMock.storage.local.clear(() => undefined);
        buildDom();
        const Controller = getController();
        const controller = new Controller();
        jest.spyOn(window, 'getComputedStyle').mockReturnValue({
            font: '16px Arial',
        } as any);
        await controller.init();
    });

    it('loads defaults into toggles', async () => {
        const searchEnable = document.getElementById('search-enable') as HTMLInputElement;
        const overviewEnable = document.getElementById('overview-enable') as HTMLInputElement;
        expect(searchEnable.checked).toBe(TAGALYST_DEFAULT_CONFIG.searchEnabled);
        expect(overviewEnable.checked).toBe(TAGALYST_DEFAULT_CONFIG.overviewEnabled);
    });

    it('saves config on toggle change', async () => {
        const searchEnable = document.getElementById('search-enable') as HTMLInputElement;
        searchEnable.checked = !searchEnable.checked;
        searchEnable.dispatchEvent(new Event('change'));
        await new Promise(resolve => setTimeout(resolve, 0));
        const data = await new Promise(resolve => chrome.storage.local.get([TAGALYST_CONFIG_STORAGE_KEY], resolve as any));
        expect((data as any)[TAGALYST_CONFIG_STORAGE_KEY].searchEnabled).toBe(searchEnable.checked);
    });

    it('merges updates without dropping other flags', async () => {
        // Rebuild with a preloaded non-default config
        document.body.innerHTML = '';
        chrome.storage.local.clear(() => undefined);
        await new Promise(resolve => chrome.storage.local.set({
            [TAGALYST_CONFIG_STORAGE_KEY]: { ...TAGALYST_DEFAULT_CONFIG, tagsEnabled: false },
        }, () => resolve(null)));
        buildDom();
        const Controller = getController();
        const controller = new Controller();
        jest.spyOn(window, 'getComputedStyle').mockReturnValue({ font: '16px Arial' } as any);
        await controller.init();

        const searchEnable = document.getElementById('search-enable') as HTMLInputElement;
        searchEnable.checked = !searchEnable.checked;
        searchEnable.dispatchEvent(new Event('change'));
        await new Promise(resolve => setTimeout(resolve, 0));
        const data = await new Promise(resolve => chrome.storage.local.get([TAGALYST_CONFIG_STORAGE_KEY], resolve as any));
        const stored = (data as any)[TAGALYST_CONFIG_STORAGE_KEY];
        expect(stored.searchEnabled).toBe(searchEnable.checked);
        expect(stored.tagsEnabled).toBe(false);
    });

    it('renders storage usage', async () => {
        const storageSize = document.getElementById('storage-size') as HTMLElement;
        expect(storageSize.textContent).toContain('bytes');
    });

    it('writes exported data to storage when importing', async () => {
        const importInput = document.getElementById('import-file') as HTMLInputElement;
        const data = { foo: 'bar' };
        const file = {
            name: 'data.json',
            type: 'application/json',
            text: () => Promise.resolve(JSON.stringify(data)),
        } as any;
        // Stub confirm to true
        jest.spyOn(window, 'confirm').mockReturnValue(true);
        const changeEvent = new Event('change');
        Object.defineProperty(importInput, 'files', {
            value: [file],
            writable: false,
        });
        importInput.dispatchEvent(changeEvent);
        await new Promise(resolve => setTimeout(resolve, 0));
        const all = await new Promise(resolve => chrome.storage.local.get(null, resolve as any));
        expect((all as any).foo).toBe('bar');
    });

    it('clears storage via clear button', async () => {
        await new Promise(resolve => chrome.storage.local.set({ foo: 'bar' }, () => resolve(null)));
        const clearBtn = document.getElementById('clear-storage') as HTMLButtonElement;
        clearBtn.click(); // prime confirmation
        await new Promise(resolve => setTimeout(resolve, 0));
        clearBtn.click(); // confirm delete
        await new Promise(resolve => setTimeout(resolve, 0));
        const all = await new Promise(resolve => chrome.storage.local.get(null, resolve as any));
        expect((all as any).foo).toBeUndefined();
    });
});
