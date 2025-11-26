// @ts-nocheck
import { describe, expect, it, beforeEach } from '@jest/globals';
// Load globals used by controllers
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

describe('Sidebar/project label retries', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('retries sidebar render when nav appears late', async () => {
        const meta = new StubMetadata({ abc123: { starred: true } });
        const controller = new SidebarLabelController(meta as any, { isSidebarLabelsEnabled: () => true } as any);
        // Start without nav present
        controller.start();
        // Later mount nav
        const nav = document.createElement('nav');
        const link = document.createElement('a');
        link.href = '/c/abc123';
        nav.appendChild(link);
        document.body.appendChild(nav);
        await new Promise(resolve => setTimeout(resolve, 400)); // allow retry
        const badges = nav.querySelectorAll('[data-ext="labels"]');
        expect(badges.length).toBe(1);
    });

    it('retries project list render when main appears late', async () => {
        const meta = new StubMetadata({ xyz: { length: 2 } });
        const controller = new ProjectListLabelController(meta as any, { isSidebarLabelsEnabled: () => true } as any);
        controller.start();
        const main = document.createElement('main');
        const list = document.createElement('ul');
        const li = document.createElement('li');
        li.className = 'project-item';
        const link = document.createElement('a');
        link.href = '/c/xyz';
        li.appendChild(link);
        list.appendChild(li);
        main.appendChild(list);
        document.body.appendChild(main);
        await new Promise(resolve => setTimeout(resolve, 400));
        const badges = main.querySelectorAll('[data-ext="project-labels"]');
        expect(badges.length).toBe(1);
    });
});
