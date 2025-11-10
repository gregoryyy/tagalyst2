const CONFIG_STORAGE_KEY = '__tagalyst_config';
const defaultConfig = {
    enableSearch: true,
    enableTagFiltering: true,
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

function init() {
    const searchToggle = document.getElementById('enable-search');
    const tagToggle = document.getElementById('enable-tags');
    const status = document.getElementById('status');

    const showStatus = (msg) => {
        status.textContent = msg;
        setTimeout(() => { status.textContent = ''; }, 1800);
    };

    getConfig().then(cfg => {
        searchToggle.checked = !!cfg.enableSearch;
        tagToggle.checked = !!cfg.enableTagFiltering;
    });

    const onChange = async () => {
        const next = {
            enableSearch: searchToggle.checked,
            enableTagFiltering: tagToggle.checked,
        };
        await saveConfig(next);
        showStatus('Saved');
    };

    searchToggle.addEventListener('change', onChange);
    tagToggle.addEventListener('change', onChange);
}

document.addEventListener('DOMContentLoaded', init);
