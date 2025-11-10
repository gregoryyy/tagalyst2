const CONFIG_STORAGE_KEY = '__tagalyst_config';
const defaultConfig = {
    searchVisible: true,
    searchInteractive: true,
    tagsVisible: true,
    tagsInteractive: true,
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
    const searchVisible = document.getElementById('search-visible');
    const searchInteractive = document.getElementById('search-interactive');
    const tagsVisible = document.getElementById('tags-visible');
    const tagsInteractive = document.getElementById('tags-interactive');
    const status = document.getElementById('status');
    const storageSizeEl = document.getElementById('storage-size');
    const clearStorageBtn = document.getElementById('clear-storage');
    const confirmLabel = 'Delete Ok?';
    const baseLabel = 'Delete';
    const tempSpan = document.createElement('span');
    tempSpan.textContent = confirmLabel;
    tempSpan.style.visibility = 'hidden';
    tempSpan.style.position = 'absolute';
    tempSpan.style.whiteSpace = 'nowrap';
    tempSpan.style.fontSize = window.getComputedStyle(clearStorageBtn).fontSize;
    document.body.appendChild(tempSpan);
    const confirmWidth = tempSpan.getBoundingClientRect().width;
    tempSpan.remove();
    const baseWidth = clearStorageBtn.offsetWidth || confirmWidth;
    const targetWidth = Math.ceil(Math.max(confirmWidth, baseWidth) + 32);
    clearStorageBtn.style.width = `${targetWidth}px`;
    clearStorageBtn.style.minWidth = `${targetWidth}px`;
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
        searchVisible.checked = !!cfg.searchVisible;
        searchInteractive.checked = !!cfg.searchInteractive;
        tagsVisible.checked = !!cfg.tagsVisible;
        tagsInteractive.checked = !!cfg.tagsInteractive;
    });

    updateStorageDisplay(storageSizeEl);

    const onChange = async () => {
        const next = {
            searchVisible: searchVisible.checked,
            searchInteractive: searchInteractive.checked,
            tagsVisible: tagsVisible.checked,
            tagsInteractive: tagsInteractive.checked,
        };
        await saveConfig(next);
        showStatus('Saved');
    };

    [searchVisible, searchInteractive, tagsVisible, tagsInteractive].forEach(el => {
        el.addEventListener('change', onChange);
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
        searchVisible.checked = defaultConfig.searchVisible;
        searchInteractive.checked = defaultConfig.searchInteractive;
        tagsVisible.checked = defaultConfig.tagsVisible;
        tagsInteractive.checked = defaultConfig.tagsInteractive;
        await updateStorageDisplay(storageSizeEl);
        showStatus('Storage cleared');
        resetButtonState();
    });
}

document.addEventListener('DOMContentLoaded', init);
