const OPTIONS_CONFIG_STORAGE_KEY = '__tagalyst_config';

interface TagalystConfig {
    searchEnabled: boolean;
    tagsEnabled: boolean;
}

const optionsDefaultConfig: TagalystConfig = {
    searchEnabled: true,
    tagsEnabled: true,
};

/**
 * Reads the persisted feature config, merging in defaults for missing fields.
 */
function getConfig(): Promise<TagalystConfig> {
    return new Promise(resolve => {
        chrome.storage.local.get([OPTIONS_CONFIG_STORAGE_KEY], (data) => {
            const value = data?.[OPTIONS_CONFIG_STORAGE_KEY] as Partial<TagalystConfig> | undefined;
            resolve({ ...optionsDefaultConfig, ...(value || {}) });
        });
    });
}

/**
 * Persists config overrides for the Search/Tag panels.
 */
function saveConfig(partial: Partial<TagalystConfig>): Promise<void> {
    return new Promise(resolve => {
        chrome.storage.local.set({ [OPTIONS_CONFIG_STORAGE_KEY]: partial }, () => resolve());
    });
}

/**
 * Calculates an approximate storage footprint for all extension keys.
 */
function getStorageUsage(): Promise<number> {
    return new Promise(resolve => {
        chrome.storage.local.get(null, (data) => {
            let bytes = 0;
            for (const key in data) {
                if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
                const val = data[key];
                const serialized = typeof val === 'string' ? val : JSON.stringify(val);
                bytes += key.length + (serialized ? serialized.length : 0);
            }
            resolve(bytes);
        });
    });
}

/**
 * Renders the formatted storage usage value within the supplied element.
 */
async function updateStorageDisplay(el: HTMLElement | null): Promise<void> {
    if (!el) return;
    const bytes = await getStorageUsage();
    const formatted = `${bytes.toLocaleString()} bytes`;
    el.textContent = formatted;
}

/**
 * Bootstraps the Options page UI bindings and event handlers.
 */
function init(): void {
    const searchEnable = document.getElementById('search-enable') as HTMLInputElement;
    const tagsEnable = document.getElementById('tags-enable') as HTMLInputElement;
    const status = document.getElementById('status') as HTMLElement;
    const storageSizeEl = document.getElementById('storage-size') as HTMLElement;
    const viewBtn = document.getElementById('view-storage') as HTMLButtonElement;
    const importBtn = document.getElementById('import-storage') as HTMLButtonElement;
    const exportBtn = document.getElementById('export-storage') as HTMLButtonElement;
    const importInput = document.getElementById('import-file') as HTMLInputElement;
    const clearStorageBtn = document.getElementById('clear-storage') as HTMLButtonElement;
    const confirmLabel = 'Delete Ok?';
    const baseLabel = 'Delete';
    const tempSpan = document.createElement('span');
    tempSpan.textContent = confirmLabel;
    tempSpan.style.visibility = 'hidden';
    tempSpan.style.position = 'absolute';
    tempSpan.style.whiteSpace = 'nowrap';
    const btnStyles = window.getComputedStyle(clearStorageBtn);
    tempSpan.style.font = btnStyles.font;
    document.body.appendChild(tempSpan);
    const confirmWidth = tempSpan.getBoundingClientRect().width;
    tempSpan.remove();
    const baseWidth = clearStorageBtn.offsetWidth || confirmWidth;
    const targetWidth = Math.ceil(Math.max(confirmWidth, baseWidth) + 32);
    [viewBtn, importBtn, exportBtn, clearStorageBtn].forEach(btn => {
        btn.style.width = `${targetWidth}px`;
        btn.style.minWidth = `${targetWidth}px`;
    });
    let confirmDelete = false;
    const resetButtonState = () => {
        confirmDelete = false;
        clearStorageBtn.classList.remove('danger');
        clearStorageBtn.textContent = baseLabel;
    };

    const showStatus = (msg: string) => {
        if (!status) return;
        status.textContent = msg;
        setTimeout(() => { status.textContent = ''; }, 1800);
    };

    getConfig().then(cfg => {
        searchEnable.checked = !!cfg.searchEnabled;
        tagsEnable.checked = !!cfg.tagsEnabled;
    });

    updateStorageDisplay(storageSizeEl);

    const onChange = async () => {
        const next = {
            searchEnabled: searchEnable.checked,
            tagsEnabled: tagsEnable.checked,
        };
        await saveConfig(next);
        showStatus('Saved');
    };

    [searchEnable, tagsEnable].forEach(el => el.addEventListener('change', onChange));

    viewBtn.addEventListener('click', async () => {
        const data = await new Promise(resolve => chrome.storage.local.get(null, resolve));
        const serialized = JSON.stringify(data, null, 2);
        const newWin = window.open('', 'tagalystStorageView');
        if (!newWin) {
            showStatus('Popup blocked');
            return;
        }
        newWin.document.write(`<pre style="font-family:monospace; white-space:pre; margin:0; padding:16px;">${serialized.replace(/</g, '&lt;')}</pre>`);
        newWin.document.title = 'Tagalyst Storage';
    });

    exportBtn.addEventListener('click', async () => {
        const data = await new Promise(resolve => chrome.storage.local.get(null, resolve));
        const serialized = JSON.stringify(data, null, 2);
        if (window.showSaveFilePicker) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: `tagalyst-storage-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
                    types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
                });
                const writable = await handle.createWritable();
                await writable.write(serialized);
                await writable.close();
                showStatus('Exported');
                return;
            } catch (err) {
                if (err.name === 'AbortError') return;
                console.error('Export failed', err);
                showStatus('Export failed');
                return;
            }
        }
        const blob = new Blob([serialized], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tagalyst-storage-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showStatus('Exported');
    });

    importBtn.addEventListener('click', () => {
        importInput.value = '';
        importInput.click();
    });

    importInput.addEventListener('change', async (evt) => {
        const input = evt.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;
        if (!confirm('Importing will overwrite all Tagalyst data. Continue?')) return;
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            await new Promise<void>(resolve => chrome.storage.local.clear(() => resolve()));
            await new Promise<void>(resolve => chrome.storage.local.set(data, () => resolve()));
            const cfg = await getConfig();
            searchEnable.checked = !!cfg.searchEnabled;
            tagsEnable.checked = !!cfg.tagsEnabled;
            await updateStorageDisplay(storageSizeEl);
            showStatus('Imported');
        } catch (err) {
            console.error('Import failed', err);
            showStatus('Import failed');
        }
    });

    clearStorageBtn.addEventListener('click', async () => {
        if (!confirmDelete) {
            confirmDelete = true;
            clearStorageBtn.classList.add('danger');
            clearStorageBtn.textContent = confirmLabel;
            setTimeout(() => {
                if (confirmDelete) resetButtonState();
            }, 2500);
            return;
        }
        await new Promise<void>(resolve => chrome.storage.local.clear(() => resolve()));
        await saveConfig({ ...optionsDefaultConfig });
        searchEnable.checked = optionsDefaultConfig.searchEnabled;
        tagsEnable.checked = optionsDefaultConfig.tagsEnabled;
        await updateStorageDisplay(storageSizeEl);
        showStatus('Storage cleared');
        resetButtonState();
    });
}

document.addEventListener('DOMContentLoaded', init);
