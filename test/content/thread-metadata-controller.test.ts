import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ThreadMetadataController } from '../test-exports';

class StubService {
    meta: any = {};
    read = jest.fn(async () => ({ ...this.meta }));
    write = jest.fn(async (_id: string, meta: any) => {
        this.meta = { ...meta };
    });
}

class StubEditor {
    openTextEditor = jest.fn();
}

describe('ThreadMetadataController', () => {
    let service: StubService;
    let editor: StubEditor;
    let controller: any;
    let parent: HTMLElement;
    let container: HTMLElement;

    beforeEach(() => {
        service = new StubService();
        editor = new StubEditor();
        controller = new ThreadMetadataController(service as any, editor as any);
        parent = document.createElement('div');
        container = document.createElement('div');
        parent.appendChild(container);
    });

    it('renders metadata header with length and name', async () => {
        controller.ensure(container, 't1');
        await controller.render('t1', { name: 'Alpha', tags: ['x'], note: 'n', length: 3 });
        const header = parent.firstElementChild as HTMLElement;
        expect(header.id).toBe('ext-thread-meta');
        expect(header.querySelector('.ext-thread-meta-name')?.textContent).toBe('Alpha');
        expect(header.querySelector('.ext-thread-meta-length')?.textContent).toContain('3 prompt');
    });

    it('saves edited name on blur', async () => {
        controller.ensure(container, 't1');
        await controller.render('t1', { name: 'Old' });
        const nameEl = parent.querySelector('.ext-thread-meta-name') as HTMLElement;
        nameEl.textContent = ' New Name ';
        nameEl.dispatchEvent(new Event('blur'));
        await Promise.resolve();
        await Promise.resolve();
        expect(service.write).toHaveBeenCalledWith('t1', expect.objectContaining({ name: 'New Name' }));
    });

    it('invokes tag editor and saves tags', async () => {
        service.meta = { tags: ['old'] };
        controller.ensure(container, 't1');
        await controller.render('t1', service.meta);
        const button = parent.querySelector('.ext-thread-meta-edit-tags') as HTMLButtonElement;
        button.click();
        await Promise.resolve();
        await Promise.resolve();
        expect(editor.openTextEditor).toHaveBeenCalled();
        const options = editor.openTextEditor.mock.calls[0][0] as any;
        await options.onSave('foo, bar');
        expect(service.write).toHaveBeenCalledWith('t1', expect.objectContaining({ tags: ['foo', 'bar'] }));
    });

    it('toggles star', async () => {
        controller.ensure(container, 't1');
        await controller.render('t1', {});
        const btn = parent.querySelector('.ext-thread-meta-star') as HTMLButtonElement;
        btn.click();
        await Promise.resolve();
        expect(service.write).toHaveBeenCalledWith('t1', expect.objectContaining({ starred: true }));
    });
});
