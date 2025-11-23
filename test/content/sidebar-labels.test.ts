import { SidebarLabelController, ProjectListLabelController } from '../test-exports';

class StubMetadata {
    constructor(private readonly meta: Record<string, any>) {}
    async read(id: string) {
        return this.meta[id] || {};
    }
}

const enabledConfig = {
    isSidebarLabelsEnabled: () => true,
};

describe('SidebarLabelController', () => {
    it('renders badges on sidebar links', async () => {
        document.body.innerHTML = `
            <nav>
                <a href="/c/abc123" id="link1"></a>
                <a href="/c/def456" id="link2"></a>
            </nav>
        `;
        const meta = new StubMetadata({
            abc123: { starred: true, tags: ['t1'], note: 'n', length: 3 },
        });
        const controller = new SidebarLabelController(meta as any, enabledConfig as any);
        await (controller as any).renderAll(document.querySelector('nav'));
        const badge = document.querySelector('#link1 [data-ext="labels"]');
        expect(badge?.textContent).toContain('★');
        expect(badge?.textContent).toContain('t1');
        expect(badge?.textContent).toContain('(3)');
        const missing = document.querySelector('#link2 [data-ext="labels"]');
        expect(missing?.textContent).toBe('');
    });
});

describe('ProjectListLabelController', () => {
    it('renders metadata line for project threads', async () => {
        document.body.innerHTML = `
            <ul>
                <li class="project-item">
                    <a href="/g/proj/c/xyz999" id="plink"></a>
                </li>
            </ul>
        `;
        const meta = new StubMetadata({
            xyz999: { starred: true, tags: ['a', 'b'], note: 'hello', length: 5, chars: 1200 },
        });
        const controller = new ProjectListLabelController(meta as any, enabledConfig as any);
        await (controller as any).renderAll();
        const badge = document.querySelector('#plink [data-ext="project-labels"]');
        expect(badge?.textContent).toContain('hello');
        expect(badge?.textContent).toContain('a, b');
        expect(badge?.textContent).toContain('5 prompts');
        expect(badge?.textContent).toContain('chars');
    });
});
