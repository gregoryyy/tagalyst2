// @ts-nocheck
import { describe, expect, it, beforeEach } from '@jest/globals';

require('../test-exports');
require('../../content/content/controllers/sidebar-labels.js');
require('../../content/content/controllers/project-list-labels.js');

const SidebarLabelController = (globalThis as any).SidebarLabelController as any;
const ProjectListLabelController = (globalThis as any).ProjectListLabelController as any;

class StubMetadata {
    constructor(private readonly meta: Record<string, any>) {}
    async read(id: string) {
        return this.meta[id] || {};
    }
}

describe('Integration: sidebar/project markers across SPA nav', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        (globalThis as any).__tagalystDebugSidebar = false;
    });

    it('re-renders sidebar markers on nav replacement without duplicates', async () => {
        const meta = new StubMetadata({
            one: { starred: true },
            two: { note: 'n' },
        });
        const controller = new SidebarLabelController(meta as any, { isSidebarLabelsEnabled: () => true } as any);

        const nav1 = document.createElement('nav');
        const link1 = document.createElement('a');
        link1.href = '/c/one';
        nav1.appendChild(link1);
        document.body.appendChild(nav1);

        controller.start();
        await new Promise(res => setTimeout(res, 10));
        expect(nav1.querySelectorAll('[data-ext="labels"]').length).toBe(1);

        // Simulate SPA nav replacing the sidebar
        nav1.remove();
        const nav2 = document.createElement('nav');
        const link2 = document.createElement('a');
        link2.href = '/c/two';
        nav2.appendChild(link2);
        document.body.appendChild(nav2);
        controller.start();
        await new Promise(res => setTimeout(res, 10));
        expect(nav2.querySelectorAll('[data-ext="labels"]').length).toBe(1);
        expect(document.querySelectorAll('[data-ext="labels"]').length).toBe(1);
    });

    it('re-renders project markers on main replacement without duplicates', async () => {
        const meta = new StubMetadata({
            a: { length: 2 },
            b: { tags: ['x'] },
        });
        const controller = new ProjectListLabelController(meta as any, { isSidebarLabelsEnabled: () => true } as any);

        const main1 = document.createElement('main');
        const list1 = document.createElement('ul');
        const li1 = document.createElement('li');
        li1.className = 'project-item';
        const link1 = document.createElement('a');
        link1.href = '/c/a';
        li1.appendChild(link1);
        list1.appendChild(li1);
        main1.appendChild(list1);
        document.body.appendChild(main1);

        controller.start();
        await new Promise(res => setTimeout(res, 10));
        expect(main1.querySelectorAll('[data-ext="project-labels"]').length).toBe(1);

        // Simulate SPA nav changing root
        main1.remove();
        const main2 = document.createElement('main');
        const list2 = document.createElement('ul');
        const li2 = document.createElement('li');
        li2.className = 'project-item';
        const link2 = document.createElement('a');
        link2.href = '/c/b';
        li2.appendChild(link2);
        list2.appendChild(li2);
        main2.appendChild(list2);
        document.body.appendChild(main2);
        controller.start();
        await new Promise(res => setTimeout(res, 10));
        expect(main2.querySelectorAll('[data-ext="project-labels"]').length).toBe(1);
        expect(document.querySelectorAll('[data-ext="project-labels"]').length).toBe(1);
    });
});
