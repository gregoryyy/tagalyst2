/// <reference path="../services/thread-metadata.ts" />
/// <reference path="../controllers/editor.ts" />

/**
 * Renders and edits thread-level metadata (name, tags, note, length).
 */
class ThreadMetadataController {
    private headerEl: HTMLElement | null = null;
    private nameEl: HTMLElement | null = null;
    private tagsEl: HTMLElement | null = null;
    private noteEl: HTMLElement | null = null;
    private lengthEl: HTMLElement | null = null;
    private currentThreadId: string | null = null;

    constructor(private readonly service: ThreadMetadataService, private readonly editor: EditorController) { }

    ensure(container: HTMLElement, threadId: string) {
        if (this.headerEl && this.currentThreadId === threadId) return this.headerEl;
        if (this.headerEl) {
            this.headerEl.remove();
            this.headerEl = null;
        }
        const header = document.createElement('div');
        header.id = 'ext-thread-meta';
        header.className = 'ext-thread-meta';
        header.innerHTML = `
            <div class="ext-thread-meta-name" contenteditable="true" aria-label="Thread name"></div>
            <div class="ext-thread-meta-row">
                <div class="ext-thread-meta-tags"></div>
                <button type="button" class="ext-thread-meta-edit-tags">Edit tags</button>
                <button type="button" class="ext-thread-meta-edit-note">Edit note</button>
            </div>
            <div class="ext-thread-meta-note"></div>
            <div class="ext-thread-meta-length"></div>
        `;
        Utils.markExtNode(header);
        container.parentElement?.insertBefore(header, container);
        this.headerEl = header;
        this.nameEl = header.querySelector('.ext-thread-meta-name');
        this.tagsEl = header.querySelector('.ext-thread-meta-tags');
        this.noteEl = header.querySelector('.ext-thread-meta-note');
        this.lengthEl = header.querySelector('.ext-thread-meta-length');
        this.currentThreadId = threadId;
        this.bindEditors(threadId);
        return header;
    }

    async render(threadId: string, meta: ThreadMetadata) {
        if (!this.headerEl || this.currentThreadId !== threadId) return;
        if (this.nameEl) this.nameEl.textContent = meta.name || 'Untitled thread';
        if (this.tagsEl) {
            this.tagsEl.innerHTML = '';
            const tags = Array.isArray(meta.tags) ? meta.tags : [];
            if (!tags.length) {
                const span = document.createElement('span');
                span.className = 'ext-thread-meta-empty';
                span.textContent = 'No tags';
                this.tagsEl.appendChild(span);
            } else {
                tags.forEach(tag => {
                    const pill = document.createElement('span');
                    pill.className = 'ext-thread-meta-pill';
                    pill.textContent = tag;
                    this.tagsEl?.appendChild(pill);
                });
            }
        }
        if (this.noteEl) this.noteEl.textContent = meta.note || '';
        if (this.lengthEl) {
            const count = typeof meta.length === 'number' ? meta.length : 0;
            this.lengthEl.textContent = `${count} message${count === 1 ? '' : 's'}`;
        }
    }

    private bindEditors(threadId: string) {
        if (this.nameEl) {
            this.nameEl.addEventListener('blur', () => this.saveName(threadId));
            this.nameEl.addEventListener('keydown', (evt) => {
                if (evt.key === 'Enter') {
                    evt.preventDefault();
                    this.saveName(threadId);
                }
            });
        }
        const editTags = this.headerEl?.querySelector<HTMLButtonElement>('.ext-thread-meta-edit-tags');
        if (editTags) {
            editTags.onclick = async () => {
                const meta = await this.service.read(threadId);
                const current = Array.isArray(meta.tags) ? meta.tags.join(', ') : '';
                this.editor.openTextEditor({
                    anchor: this.headerEl as HTMLElement,
                    value: current,
                    title: 'Thread tags',
                    placeholder: 'comma,separated,tags',
                    saveOnEnter: true,
                    onSave: async (val) => {
                        const tags = (val || '').split(',').map(t => t.trim()).filter(Boolean);
                        meta.tags = tags;
                        await this.service.write(threadId, meta);
                        this.render(threadId, meta);
                    },
                });
            };
        }
        const editNote = this.headerEl?.querySelector<HTMLButtonElement>('.ext-thread-meta-edit-note');
        if (editNote) {
            editNote.onclick = async () => {
                const meta = await this.service.read(threadId);
                const current = typeof meta.note === 'string' ? meta.note : '';
                this.editor.openTextEditor({
                    anchor: this.headerEl as HTMLElement,
                    value: current,
                    title: 'Thread note',
                    placeholder: 'Add details…',
                    saveOnCtrlEnter: true,
                    onSave: async (val) => {
                        const trimmed = (val || '').trim();
                        meta.note = trimmed || undefined;
                        await this.service.write(threadId, meta);
                        this.render(threadId, meta);
                    },
                });
            };
        }
    }

    private async saveName(threadId: string) {
        if (!this.nameEl) return;
        const meta = await this.service.read(threadId);
        const name = (this.nameEl.textContent || '').trim();
        meta.name = name || undefined;
        await this.service.write(threadId, meta);
        this.render(threadId, meta);
    }
}

// Expose for tests
(globalThis as any).ThreadMetadataController = ThreadMetadataController;
