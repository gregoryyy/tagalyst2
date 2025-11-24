/// <reference path="./shared/config.ts" />
/// <reference path="./shared/storage.ts" />

/**
 * Reads the persisted feature config, merging in defaults for missing fields.
 */
function getConfig(): Promise<TagalystConfig> {
    return tagalystStorage.read([TAGALYST_CONFIG_STORAGE_KEY]).then(async data => {
        const stored = data?.[TAGALYST_CONFIG_STORAGE_KEY] as Partial<TagalystConfig> | undefined;
        const merged = { ...TAGALYST_DEFAULT_CONFIG, ...(stored || {}) };
        const changed = !stored || Object.keys(TAGALYST_DEFAULT_CONFIG).some(key => (stored as any)[key] !== (merged as any)[key]);
        if (changed) {
            await tagalystStorage.write({ [TAGALYST_CONFIG_STORAGE_KEY]: merged });
        }
        return merged;
    });
}

/**
 * Persists config overrides for the Search/Tag panels.
 */
function saveConfig(partial: Partial<TagalystConfig>): Promise<void> {
    return tagalystStorage.write({ [TAGALYST_CONFIG_STORAGE_KEY]: partial });
}

/**
 * Calculates an approximate storage footprint for all extension keys.
 */
function getStorageUsage(): Promise<number> {
    return tagalystStorage.readAll().then(data => {
        let bytes = 0;
        for (const key in data) {
            if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
            const val = data[key];
            const serialized = typeof val === 'string' ? val : JSON.stringify(val);
            bytes += key.length + (serialized ? serialized.length : 0);
        }
        return bytes;
    });
}

/**
 * Updates a status element with a transient message.
 */
function setStatus(el: HTMLElement | null, msg: string, timeoutMs = 1800) {
    if (!el) return;
    el.textContent = msg;
    setTimeout(() => { el.textContent = ''; }, timeoutMs);
}

/**
 * Renders the formatted storage usage value within the supplied element.
 */
async function renderStorageUsage(el: HTMLElement | null): Promise<void> {
    if (!el) return;
    const bytes = await getStorageUsage();
    el.textContent = `${bytes.toLocaleString()} bytes`;
}

/**
 * Normalizes button widths based on delete confirmation label sizing.
 */
function normalizeButtonWidths(buttons: HTMLButtonElement[], deleteBtn: HTMLButtonElement, confirmLabel = 'Delete Ok?', baseLabel = 'Delete') {
    const tempSpan = document.createElement('span');
    tempSpan.textContent = confirmLabel;
    tempSpan.style.visibility = 'hidden';
    tempSpan.style.position = 'absolute';
    tempSpan.style.whiteSpace = 'nowrap';
    const btnStyles = window.getComputedStyle(deleteBtn);
    tempSpan.style.font = btnStyles.font;
    document.body.appendChild(tempSpan);
    const confirmWidth = tempSpan.getBoundingClientRect().width;
    tempSpan.remove();
    const baseWidth = deleteBtn.offsetWidth || confirmWidth;
    const targetWidth = Math.ceil(Math.max(confirmWidth, baseWidth) + 32);
    buttons.forEach(btn => {
        btn.style.width = `${targetWidth}px`;
        btn.style.minWidth = `${targetWidth}px`;
    });
    deleteBtn.dataset.baseLabel = baseLabel;
    deleteBtn.dataset.confirmLabel = confirmLabel;
    return { baseLabel, confirmLabel };
}

/**
 * Options page controller that owns UI bindings and interactions.
 */
class OptionsController {
    private searchEnable!: HTMLInputElement;
    private searchExpand!: HTMLInputElement;
    private tagsEnable!: HTMLInputElement;
    private tagsExpand!: HTMLInputElement;
    private overviewEnable!: HTMLInputElement;
    private overviewExpand!: HTMLInputElement;
    private metaToolbarEnable!: HTMLInputElement;
    private navToolbarEnable!: HTMLInputElement;
    private sidebarLabelsEnable!: HTMLInputElement;
    private statusEl!: HTMLElement;
    private storageSizeEl!: HTMLElement;
    private viewBtn!: HTMLButtonElement;
    private importBtn!: HTMLButtonElement;
    private exportBtn!: HTMLButtonElement;
    private importInput!: HTMLInputElement;
    private clearStorageBtn!: HTMLButtonElement;
    private confirmDelete = false;
    private deleteLabels = { baseLabel: 'Delete', confirmLabel: 'Delete Ok?' };

    async init(): Promise<void> {
        this.cacheDom();
        this.deleteLabels = normalizeButtonWidths([this.viewBtn, this.importBtn, this.exportBtn, this.clearStorageBtn], this.clearStorageBtn);
        await this.loadConfig();
        await renderStorageUsage(this.storageSizeEl);
        this.bindEvents();
    }

    private cacheDom() {
        this.searchEnable = document.getElementById('search-enable') as HTMLInputElement;
        this.searchExpand = document.getElementById('search-expand') as HTMLInputElement;
        this.tagsEnable = document.getElementById('tags-enable') as HTMLInputElement;
        this.tagsExpand = document.getElementById('tags-expand') as HTMLInputElement;
        this.overviewEnable = document.getElementById('overview-enable') as HTMLInputElement;
        this.overviewExpand = document.getElementById('overview-expand') as HTMLInputElement;
        this.metaToolbarEnable = document.getElementById('meta-toolbar-enable') as HTMLInputElement;
        this.navToolbarEnable = document.getElementById('nav-toolbar-enable') as HTMLInputElement;
        this.sidebarLabelsEnable = document.getElementById('sidebar-labels-enable') as HTMLInputElement;
        this.statusEl = document.getElementById('status') as HTMLElement;
        this.storageSizeEl = document.getElementById('storage-size') as HTMLElement;
        this.viewBtn = document.getElementById('view-storage') as HTMLButtonElement;
        this.importBtn = document.getElementById('import-storage') as HTMLButtonElement;
        this.exportBtn = document.getElementById('export-storage') as HTMLButtonElement;
        this.importInput = document.getElementById('import-file') as HTMLInputElement;
        this.clearStorageBtn = document.getElementById('clear-storage') as HTMLButtonElement;
    }

    private async loadConfig() {
        const cfg = await getConfig();
        this.setToggleState(cfg);
    }

    private bindEvents() {
        const onChange = async () => {
            const next = {
                searchEnabled: this.searchEnable.checked,
                tagsEnabled: this.tagsEnable.checked,
                searchExpands: !!this.searchExpand?.checked,
                tagsExpands: !!this.tagsExpand?.checked,
                overviewEnabled: !!this.overviewEnable?.checked,
                overviewExpands: !!this.overviewExpand?.checked,
                metaToolbarEnabled: !!this.metaToolbarEnable?.checked,
                navToolbarEnabled: !!this.navToolbarEnable?.checked,
                sidebarLabelsEnabled: !!this.sidebarLabelsEnable?.checked,
            };
            await saveConfig(next);
            setStatus(this.statusEl, 'Saved');
        };

        [
            this.searchEnable,
            this.tagsEnable,
            this.searchExpand,
            this.tagsExpand,
            this.overviewEnable,
            this.overviewExpand,
            this.metaToolbarEnable,
            this.navToolbarEnable,
            this.sidebarLabelsEnable,
        ].filter(Boolean).forEach(el => el?.addEventListener('change', onChange));

        this.viewBtn.addEventListener('click', async () => {
            const data = await tagalystStorage.readAll();
            const serialized = JSON.stringify(data, null, 2);
            const newWin = window.open('', 'tagalystStorageView');
            if (!newWin) {
                setStatus(this.statusEl, 'Popup blocked');
                return;
            }
            newWin.document.write(`<pre style="font-family:monospace; white-space:pre; margin:0; padding:16px;">${serialized.replace(/</g, '&lt;')}</pre>`);
            newWin.document.title = 'Tagalyst Storage';
        });

        this.exportBtn.addEventListener('click', async () => {
            const data = await tagalystStorage.readAll();
            const serialized = JSON.stringify(data, null, 2);
            const savePicker = (window as any).showSaveFilePicker;
            if (savePicker) {
                try {
                    const handle = await savePicker({
                        suggestedName: `tagalyst-storage-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
                        types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
                    });
                    const writable = await handle.createWritable();
                    await writable.write(serialized);
                    await writable.close();
                    setStatus(this.statusEl, 'Exported');
                    return;
                } catch (err) {
                    if ((err as any).name === 'AbortError') return;
                    console.error('Export failed', err);
                    setStatus(this.statusEl, 'Export failed');
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
            setStatus(this.statusEl, 'Exported');
        });

        this.importBtn.addEventListener('click', () => {
            this.importInput.value = '';
            this.importInput.click();
        });

        this.importInput.addEventListener('change', async (evt) => {
            const input = evt.target as HTMLInputElement;
            const file = input.files?.[0];
            if (!file) return;
            if (!confirm('Importing will overwrite all Tagalyst data. Continue?')) return;
            try {
                const text = await file.text();
                const data = JSON.parse(text);
                await tagalystStorage.clear();
                await tagalystStorage.write(data);
                const cfg = await getConfig();
                this.setToggleState(cfg);
                await renderStorageUsage(this.storageSizeEl);
                setStatus(this.statusEl, 'Imported');
            } catch (err) {
                console.error('Import failed', err);
                setStatus(this.statusEl, 'Import failed');
            }
        });

        this.clearStorageBtn.addEventListener('click', async () => {
            if (!this.confirmDelete) {
                this.confirmDelete = true;
                this.clearStorageBtn.classList.add('danger');
                this.clearStorageBtn.textContent = this.deleteLabels.confirmLabel || this.clearStorageBtn.dataset.confirmLabel || 'Delete Ok?';
                setTimeout(() => {
                    if (this.confirmDelete) this.resetDeleteButton();
                }, 2500);
                return;
            }
            await tagalystStorage.clear();
            await saveConfig({ ...TAGALYST_DEFAULT_CONFIG });
            this.setToggleState(TAGALYST_DEFAULT_CONFIG);
            await renderStorageUsage(this.storageSizeEl);
            setStatus(this.statusEl, 'Storage cleared');
            this.resetDeleteButton();
        });
    }

    private setToggleState(cfg: TagalystConfig) {
        this.searchEnable.checked = !!cfg.searchEnabled;
        this.tagsEnable.checked = !!cfg.tagsEnabled;
        if (this.searchExpand) this.searchExpand.checked = !!cfg.searchExpands;
        if (this.tagsExpand) this.tagsExpand.checked = !!cfg.tagsExpands;
        if (this.overviewEnable) this.overviewEnable.checked = !!cfg.overviewEnabled;
        if (this.overviewExpand) this.overviewExpand.checked = !!cfg.overviewExpands;
        if (this.metaToolbarEnable) this.metaToolbarEnable.checked = cfg.metaToolbarEnabled !== false;
        if (this.navToolbarEnable) this.navToolbarEnable.checked = cfg.navToolbarEnabled !== false;
        if (this.sidebarLabelsEnable) this.sidebarLabelsEnable.checked = cfg.sidebarLabelsEnabled !== false;
    }

    private resetDeleteButton() {
        this.confirmDelete = false;
        this.clearStorageBtn.classList.remove('danger');
        this.clearStorageBtn.textContent = this.deleteLabels.baseLabel || this.clearStorageBtn.dataset.baseLabel || 'Delete';
    }
}

(globalThis as any).OptionsController = OptionsController;

document.addEventListener('DOMContentLoaded', () => {
    const controller = new OptionsController();
    controller.init();
});
