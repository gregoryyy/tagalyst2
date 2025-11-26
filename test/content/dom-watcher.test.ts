import { DomWatcher, Utils } from '../test-exports';

describe('DomWatcher', () => {
    it('fires onMutations for external DOM changes', async () => {
        const calls: Array<'mut' | 'nav' | 'root'> = [];
        const watcher = new DomWatcher({
            onMutations: () => calls.push('mut'),
            onNav: () => calls.push('nav'),
            onRootChange: () => calls.push('root'),
        });
        const container = document.createElement('div');
        document.body.appendChild(container);
        watcher.watchContainer(container);
        const child = document.createElement('div');
        container.appendChild(child);
        const another = document.createElement('div');
        Utils.markExtNode(another);
        container.appendChild(another);
        await new Promise(res => setTimeout(res, 10));
        expect(calls).toContain('mut');
        expect(calls).toContain('root');
        watcher.teardown();
    });

    it('detects root changes and reattaches', async () => {
        const calls: Array<'mut' | 'nav' | 'root'> = [];
        const watcher = new DomWatcher({
            onMutations: () => calls.push('mut'),
            onNav: () => calls.push('nav'),
            onRootChange: () => calls.push('root'),
        });
        const first = document.createElement('div');
        document.body.appendChild(first);
        watcher.watchContainer(first);
        const second = document.createElement('div');
        document.body.appendChild(second);
        watcher.watchContainer(second);
        const child = document.createElement('div');
        second.appendChild(child);
        await new Promise(res => setTimeout(res, 10));
        expect(calls.filter(c => c === 'root').length).toBeGreaterThanOrEqual(1);
        expect(calls).toContain('mut');
        watcher.teardown();
    });
});
