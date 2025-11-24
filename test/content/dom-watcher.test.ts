import { DomWatcher, Utils } from '../test-exports';

describe('DomWatcher', () => {
    it('fires onMutations for external DOM changes', async () => {
        const calls: Array<'mut' | 'nav'> = [];
        const watcher = new DomWatcher({
            onMutations: () => calls.push('mut'),
            onNav: () => calls.push('nav'),
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
        watcher.teardown();
    });
});
