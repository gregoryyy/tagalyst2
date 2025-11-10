const CONFIG_STORAGE_KEY = '__tagalyst_config';
const defaultConfig = {
    searchEnabled: true,
    tagsEnabled: true,
};

function getConfig() {
    return new Promise(resolve => {
        chrome.storage.local.get([CONFIG_STORAGE_KEY], (data) => {
            const value = data?.[CONFIG_STORAGE_KEY];
            resolve({ ...defaultConfig, ...(value || {}) });
        });
    });
}

function saveConfig(partial) {
    return new Promise(resolve => {
        chrome.storage.local.set({ [CONFIG_STORAGE_KEY]: partial }, resolve);
    });
}

function getStorageUsage() {
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

async function updateStorageDisplay(el) {
    const bytes = await getStorageUsage();
    const formatted = `${bytes.toLocaleString()} bytes`;
    el.textContent = formatted;
}

function init() {
    const searchEnable = document.getElementById('search-enable');
    const tagsEnable = document.getElementById('tags-enable');
    const status = document.getElementById('status');
    const storageSizeEl = document.getElementById('storage-size');
    const importBtn = document.getElementById('import-storage');
    const exportBtn = document.getElementById('export-storage');
    const importInput = document.getElementById('import-file');
    const clearStorageBtn = document.getElementById('clear-storage');
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
    [importBtn, exportBtn, clearStorageBtn].forEach(btn => {
        btn.style.width = `${targetWidth}px`;
        btn.style.minWidth = `${targetWidth}px`;
    });
    let confirmDelete = false;
    const resetButtonState = () => {
        confirmDelete = false;
        clearStorageBtn.classList.remove('danger');
        clearStorageBtn.textContent = baseLabel;
    };

    const showStatus = (msg) => {
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

    exportBtn.addEventListener('click', async () => {
        const data = await new Promise(resolve => chrome.storage.local.get(null, resolve));
        const serialized = JSON.stringify(data, null, 2);
        if (window.showSaveFilePicker) {
            try {
                const handle = await showSaveFilePicker({
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
        const file = evt.target.files?.[0];
        if (!file) return;
        if (!confirm('Importing will overwrite all Tagalyst data. Continue?')) return;
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            await new Promise(resolve => chrome.storage.local.clear(resolve));
            await new Promise(resolve => chrome.storage.local.set(data, resolve));
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
        await new Promise(resolve => chrome.storage.local.clear(resolve));
        await saveConfig({ ...defaultConfig });
        searchEnable.checked = defaultConfig.searchEnabled;
        tagsEnable.checked = defaultConfig.tagsEnabled;
        await updateStorageDisplay(storageSizeEl);
        showStatus('Storage cleared');
        resetButtonState();
    });
}

document.addEventListener('DOMContentLoaded', init);
