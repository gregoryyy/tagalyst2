import { describe, expect, it } from '@jest/globals';
import { FocusService } from '../test-exports';

class FakeConfigService {
    isSearchEnabled() { return true; }
    areTagsEnabled() { return true; }
    doesSearchExpand() { return false; }
    doTagsExpand() { return false; }
}

const makeMessage = (idx: number) => {
    const el = document.createElement('div');
    el.setAttribute('data-message-id', `mid-${idx}`);
    el.innerText = `message ${idx}`;
    // emulate layout
    el.getBoundingClientRect = () => ({ top: idx * 10, left: 0, width: 100, height: 20, bottom: idx * 10 + 20, right: 100 } as any);
    document.body.appendChild(el);
    return {
        el,
        meta: {
            value: { starred: idx % 10 === 0, tags: idx % 15 === 0 ? ['foo'] : [] },
            adapter: {
                element: el,
                getText: () => el.innerText,
            },
        },
    };
};

const makeRegistry = (entries: Array<{ el: HTMLElement; meta: any }>) => {
    const store = new Map<HTMLElement, any>();
    entries.forEach(({ el, meta }) => store.set(el, meta));
    return {
        forEach: (cb: (meta: any, el: HTMLElement) => void) => store.forEach((meta, el) => cb(meta, el)),
        delete: (el: HTMLElement) => { store.delete(el); },
        get: (el: HTMLElement) => store.get(el) || null,
        resolveAdapter: (el: HTMLElement) => ({
            element: el,
            getText: () => el.innerText,
        }),
    };
};

describe('Integration smoke: focus on large thread', () => {
    it('handles many messages without errors and returns sorted matches', () => {
        const sizes = [50, 100, 200];
        const durations: number[] = [];
        for (const size of sizes) {
            document.body.innerHTML = '';
            const entries = Array.from({ length: size }, (_, i) => makeMessage(i));
            const registry = makeRegistry(entries);
            const focus = new FocusService(new FakeConfigService() as any);
            focus.syncMode();
            const start = performance.now();
            const matches = focus.getMatches(registry as any);
            const duration = performance.now() - start;
            durations.push(duration);
            expect(matches.length).toBe(Math.ceil(size / 10)); // starred every 10th
            // ensure sorted ascending by position
            const tops = matches.map((m: any) => m.element.getBoundingClientRect().top);
            const sorted = [...tops].sort((a, b) => a - b);
            expect(tops).toEqual(sorted);
        }
        const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
        expect(avg).toBeLessThan(250); // basic load guard across sizes
    });
});
