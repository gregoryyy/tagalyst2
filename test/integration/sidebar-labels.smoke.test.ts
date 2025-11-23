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

describe('SidebarLabelController smoke', () => {
    it('renders and updates badges when nav changes', async () => {
        document.body.innerHTML = `
            <nav>
                <a href="/c/abc123" id="link1"></a>
            </nav>
        `;
        const meta = new StubMetadata({
            abc123: { starred: true, tags: ['x'], length: 2 },
            def456: { note: 'hello', tags: ['y'] },
        });
        const controller = new SidebarLabelController(meta as any, enabledConfig as any);
        await (controller as any).renderAll(document.querySelector('nav'));
        let badge1 = document.querySelector('#link1 [data-ext="labels"]');
        expect(badge1?.textContent).toContain('★');
        expect(badge1?.textContent).toContain('(2)');

        // Simulate nav change: add another link and ensure badge is rendered without duplicates.
        const nav = document.querySelector('nav') as HTMLElement;
        const link2 = document.createElement('a');
        link2.href = '/c/def456';
        link2.id = 'link2';
        nav.appendChild(link2);
        await (controller as any).renderAll(nav);
        const badge2 = document.querySelector('#link2 [data-ext="labels"]');
        expect(badge2?.textContent).toContain('y');

        // Ensure no duplicate badges on link1
        const badgeNodes = document.querySelectorAll('#link1 [data-ext="labels"]');
        expect(badgeNodes.length).toBe(1);
    });
});

describe('ProjectListLabelController smoke', () => {
    it('renders badges for late-loaded project items', async () => {
        document.body.innerHTML = `
            <ul id="plist"></ul>
        `;
        const meta = new StubMetadata({
            xyz999: { starred: true, tags: ['a'], note: 'n', length: 3 },
        });
        const controller = new ProjectListLabelController(meta as any, enabledConfig as any);
        const list = document.getElementById('plist') as HTMLElement;

        // Initially empty, then we append a project item.
        await (controller as any).renderAll(list);
        expect(document.querySelector('[data-ext="project-labels"]')).toBeNull();

        const li = document.createElement('li');
        li.className = 'project-item';
        li.innerHTML = `<a href="/g/proj/c/xyz999" id="plink">Thread</a>`;
        list.appendChild(li);

        await (controller as any).renderAll(list);
        const badge = document.querySelector('#plink [data-ext="project-labels"]');
        expect(badge?.textContent).toContain('a');
        expect(badge?.textContent).toContain('n');
        expect(badge?.textContent).toContain('3 prompts');
    });
});
