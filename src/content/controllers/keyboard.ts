/// <reference path="../services/config.ts" />
/// <reference path="../services/storage.ts" />
/// <reference path="../dom/thread-dom.ts" />
/// <reference path="../state/focus.ts" />
/// <reference path="../controllers/thread-actions.ts" />
/// <reference path="../controllers/export.ts" />
/// <reference path="../state/message-meta.ts" />
/// <reference path="./top-panel.ts" />

type Shortcut = {
    function: keyof KeyboardController['actionHandlers'];
    description: string;
    key: string;
    modifiers?: string[] | null;
};

type KeyboardDeps = {
    threadDom: ThreadDom;
    focusService: FocusService;
    focusController: FocusController;
    threadActions: ThreadActions;
    exportController: any;
    storageService: StorageService;
    messageMetaRegistry: MessageMetaRegistry;
    topPanelController: TopPanelController;
};

class KeyboardController {
    private container: HTMLElement | null = null;
    private shortcuts: Shortcut[] | null = null;
    private loading = false;

    constructor(private readonly deps: KeyboardDeps) { }

    attach(container: HTMLElement) {
        this.container = container;
        this.ensureKeymap();
        document.removeEventListener('keydown', this.onKeyDown, true);
        document.addEventListener('keydown', this.onKeyDown, true);
    }

    detach() {
        document.removeEventListener('keydown', this.onKeyDown, true);
        this.container = null;
    }

    private onKeyDown = (evt: KeyboardEvent) => {
        const container = this.container;
        if (!container) return;
        if (this.shouldIgnore(evt)) return;
        if (!this.shortcuts) return;
        const mods = this.modifierSet(evt);
        const key = evt.key;
        const match = this.shortcuts.find(sc => sc.key === key && this.modsMatch(sc.modifiers, mods));
        if (!match) return;
        const handler = this.actionHandlers[match.function];
        if (!handler) return;
        evt.preventDefault();
        try {
            console.debug('[Tagalyst keyboard]', match.function, match.key, Array.from(mods).join('+'));
        } catch { /* ignore debug failures */ }
        handler.call(this, container, mods);
    };

    private shouldIgnore(evt: KeyboardEvent) {
        const target = evt.target as HTMLElement | null;
        if (!target) return false;
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
        if ((target as HTMLElement).isContentEditable) return true;
        return false;
    }

    private handleVertical(container: HTMLElement, key: 'ArrowUp' | 'ArrowDown', ctrlOpt: boolean, meta: boolean) {
        const delta = key === 'ArrowUp' ? -1 : 1;
        if (meta) {
            const nodes = this.deps.threadDom.getNavigationNodes(container);
            if (!nodes.length) return;
            const target = key === 'ArrowUp' ? nodes[0] : nodes[nodes.length - 1];
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }
        if (ctrlOpt) {
            const matches = this.deps.focusController.getMatches();
            if (matches.length) {
                const targetIdx = this.deps.focusService.adjustNav(delta, matches.length);
                const target = matches[targetIdx]?.element;
                if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                return;
            }
            // fall back to regular navigation when no focus subset
        }
        const nodes = this.deps.threadDom.getNavigationNodes(container);
        if (!nodes.length) return;
        const currentIdx = this.findNearestIndex(nodes);
        const nextIdx = meta
            ? (key === 'ArrowUp' ? 0 : nodes.length - 1)
            : Math.max(0, Math.min(currentIdx + delta, nodes.length - 1));
        const target = nodes[nextIdx];
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    private handleHorizontal(container: HTMLElement, key: 'ArrowLeft' | 'ArrowRight', ctrlOpt: boolean, meta: boolean) {
        const collapse = key === 'ArrowLeft';
        if (meta) {
            this.deps.threadActions.toggleAll(container, collapse);
            return;
        }
        if (ctrlOpt) {
            this.deps.threadActions.collapseByFocus(container, 'out', collapse);
            return;
        }
        const current = this.getCurrentMessage(container);
        if (current) {
            this.deps.threadActions.collapse(current, collapse);
        }
    }

    private handleCopy(container: HTMLElement, includeAll: boolean) {
        this.deps.exportController.copyThread(container, includeAll ? false : true);
    }

    private focusSearchInput() {
        const panel = this.deps.topPanelController.getElement() || this.deps.topPanelController.ensurePanels();
        const input = panel ? panel.querySelector('.ext-search-input') as HTMLInputElement | null : null;
        if (input) {
            input.focus();
            input.select();
        }
    }

    private toggleStarOnCurrent(container: HTMLElement) {
        const el = this.getCurrentMessage(container);
        if (!el) return;
        const registry = this.deps.messageMetaRegistry;
        const meta = registry.get(el);
        const key = meta?.key;
        if (!key) return;
        const value = { ...(meta?.value || {}) };
        value.starred = !value.starred;
        this.deps.storageService.write({ [key]: value });
        registry.update(el, { value });
        this.deps.focusController.refreshButtons();
    }

    private findNearestIndex(nodes: HTMLElement[]) {
        const midpoint = window.scrollY + window.innerHeight / 2;
        let bestIdx = 0;
        let bestDist = Number.POSITIVE_INFINITY;
        nodes.forEach((el, idx) => {
            const rect = el.getBoundingClientRect();
            const top = rect.top + window.scrollY;
            const dist = Math.abs(top - midpoint);
            if (dist < bestDist) {
                bestDist = dist;
                bestIdx = idx;
            }
        });
        return bestIdx;
    }

    private getCurrentMessage(container: HTMLElement) {
        const nodes = this.deps.threadDom.getNavigationNodes(container);
        if (!nodes.length) return null;
        return nodes[this.findNearestIndex(nodes)] || null;
    }

    private modsMatch(expected: string[] | null | undefined, actual: Set<string>) {
        if (!expected) return actual.size === 0;
        const arr = Array.isArray(expected) ? expected : String(expected).split(',').map(s => s.trim()).filter(Boolean);
        if (!arr.length) return actual.size === 0;
        const normalized = arr.map(m => m.toLowerCase());
        return normalized.every(m => actual.has(m));
    }

    private modifierSet(evt: KeyboardEvent) {
        const set = new Set<string>();
        const metaPressed = !!evt.metaKey;
        if (evt.ctrlKey || metaPressed) set.add('ctrl');
        if (evt.altKey || metaPressed) set.add('alt');
        if (metaPressed) set.add('meta');
        if (evt.shiftKey) set.add('shift');
        return set;
    }

    private async ensureKeymap() {
        if (this.shortcuts || this.loading) return;
        this.loading = true;
        try {
            this.shortcuts = await this.loadKeymap();
        } catch {
            this.shortcuts = null;
        } finally {
            this.loading = false;
        }
    }

    private async loadKeymap(): Promise<Shortcut[]> {
        const url = chrome.runtime.getURL('content/keymap.yaml');
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error('fetch failed');
            const text = await res.text();
            const parsed = this.parseYaml(text);
            return parsed.length ? parsed : this.defaultShortcuts();
        } catch {
            return this.defaultShortcuts();
        }
    }

    private parseYaml(text: string): Shortcut[] {
        const lines = text.split(/\r?\n/);
        const shortcuts: Shortcut[] = [];
        let current: any = null;
        for (const raw of lines) {
            const line = raw.trim();
            if (!line || line.startsWith('#')) continue;
            if (line.startsWith('- ')) {
                if (current) shortcuts.push(current);
                current = {};
                const rest = line.slice(2).trim();
                if (rest) {
                    const [k, v] = rest.split(':').map(s => s.trim());
                    if (k && v) current[k] = this.cleanValue(v);
                }
            } else if (current) {
                const [k, v] = line.split(':').map(s => s.trim());
                if (!k) continue;
                if (v && v.startsWith('[') && v.endsWith(']')) {
                    const inner = v.slice(1, -1).trim();
                    current[k] = inner ? inner.split(',').map(s => s.trim()) : [];
                } else {
                    current[k] = this.cleanValue(v);
                }
            }
        }
        if (current) shortcuts.push(current);
        return shortcuts as Shortcut[];
    }

    private cleanValue(v?: string | null) {
        if (!v) return '';
        return v.replace(/^['"]|['"]$/g, '');
    }

    private defaultShortcuts(): Shortcut[] {
        return [
            { function: 'prevMessage', description: 'prev message', key: 'ArrowUp' },
            { function: 'nextMessage', description: 'next message', key: 'ArrowDown' },
            { function: 'prevMarked', description: 'prev marked', key: 'ArrowUp', modifiers: ['Ctrl', 'Alt'] },
            { function: 'nextMarked', description: 'next marked', key: 'ArrowDown', modifiers: ['Ctrl', 'Alt'] },
            { function: 'firstMessage', description: 'first message', key: 'ArrowUp', modifiers: ['Ctrl', 'Alt', 'Meta'] },
            { function: 'lastMessage', description: 'last message', key: 'ArrowDown', modifiers: ['Ctrl', 'Alt', 'Meta'] },
            { function: 'collapseCurrent', description: 'collapse', key: 'ArrowLeft' },
            { function: 'expandCurrent', description: 'expand', key: 'ArrowRight' },
            { function: 'collapseUnmarked', description: 'collapse others', key: 'ArrowLeft', modifiers: ['Ctrl', 'Alt'] },
            { function: 'expandUnmarked', description: 'expand others', key: 'ArrowRight', modifiers: ['Ctrl', 'Alt'] },
            { function: 'collapseAll', description: 'collapse all', key: 'ArrowLeft', modifiers: ['Ctrl', 'Alt', 'Meta'] },
            { function: 'expandAll', description: 'expand all', key: 'ArrowRight', modifiers: ['Ctrl', 'Alt', 'Meta'] },
            { function: 'copyMarked', description: 'copy marked', key: 'c', modifiers: ['Ctrl', 'Alt'] },
            { function: 'copyAll', description: 'copy all', key: 'c', modifiers: ['Ctrl', 'Alt', 'Meta'] },
            { function: 'focusSearch', description: 'focus search', key: 's', modifiers: ['Ctrl', 'Alt'] },
            { function: 'toggleStar', description: 'toggle star', key: '*', modifiers: ['Ctrl', 'Alt'] },
        ];
    }

    private actionHandlers: Record<string, (container: HTMLElement, mods: Set<string>) => void> = {
        prevMessage: (container, mods) => this.handleVertical(container, 'ArrowUp', mods.has('ctrl'), mods.has('meta')),
        nextMessage: (container, mods) => this.handleVertical(container, 'ArrowDown', mods.has('ctrl'), mods.has('meta')),
        prevMarked: (container, mods) => this.handleVertical(container, 'ArrowUp', mods.has('ctrl'), mods.has('meta')),
        nextMarked: (container, mods) => this.handleVertical(container, 'ArrowDown', mods.has('ctrl'), mods.has('meta')),
        firstMessage: (container, mods) => this.handleVertical(container, 'ArrowUp', mods.has('ctrl'), mods.has('meta')),
        lastMessage: (container, mods) => this.handleVertical(container, 'ArrowDown', mods.has('ctrl'), mods.has('meta')),
        collapseCurrent: (container, mods) => this.handleHorizontal(container, 'ArrowLeft', mods.has('ctrl'), mods.has('meta')),
        expandCurrent: (container, mods) => this.handleHorizontal(container, 'ArrowRight', mods.has('ctrl'), mods.has('meta')),
        collapseUnmarked: (container, mods) => this.handleHorizontal(container, 'ArrowLeft', mods.has('ctrl'), mods.has('meta')),
        expandUnmarked: (container, mods) => this.handleHorizontal(container, 'ArrowRight', mods.has('ctrl'), mods.has('meta')),
        collapseAll: (container, mods) => this.handleHorizontal(container, 'ArrowLeft', mods.has('ctrl'), mods.has('meta')),
        expandAll: (container, mods) => this.handleHorizontal(container, 'ArrowRight', mods.has('ctrl'), mods.has('meta')),
        copyMarked: (container, mods) => this.handleCopy(container, mods.has('meta')),
        copyAll: (container, mods) => this.handleCopy(container, true),
        focusSearch: (_container, _mods) => this.focusSearchInput(),
        toggleStar: (container, _mods) => this.toggleStarOnCurrent(container),
    };
}
