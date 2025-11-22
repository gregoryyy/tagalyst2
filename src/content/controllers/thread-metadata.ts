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
    private sizeEl: HTMLElement | null = null;
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
        header.className = 'ext-thread-meta ext-toolbar';
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.justifyContent = 'space-between';
        header.style.flex = '1 1 auto';
        header.style.width = 'auto';
        header.style.maxWidth = '100%';
        header.style.margin = '0';
        header.style.gap = '12px';
        header.style.padding = '.25rem .65rem';
        header.style.borderRadius = '12px';
        header.innerHTML = `
            <div class="ext-thread-meta-left" style="display:flex;flex-direction:column;gap:4px;flex:1 1 auto;min-width:0;">
                <div class="ext-thread-meta-name" contenteditable="true" aria-label="Thread name" style="font-size:15px;font-weight:600;line-height:1.3;"></div>
                <div class="ext-thread-meta-sub" style="display:flex;flex-wrap:wrap;gap:8px;font-size:12px;color:#444;align-items:center;">
                    <span class="ext-thread-meta-length"></span>
                    <span class="ext-thread-meta-size"></span>
                    <span class="ext-thread-meta-tags"></span>
                    <span class="ext-thread-meta-note"></span>
                </div>
            </div>
            <div class="ext-thread-meta-right ext-toolbar" style="display:flex;gap:6px;flex-shrink:0;padding:0;border:none;box-shadow:none;background:transparent;">
                <button type="button" class="ext-thread-meta-edit-name" title="Edit title (C)"><span class="ext-btn-icon">✎<small>C</small></span></button>
                <button type="button" class="ext-thread-meta-edit-tags" title="Edit tags (T)"><span class="ext-btn-icon">✎<small>T</small></span></button>
                <button type="button" class="ext-thread-meta-edit-note" title="Edit annotation (A)"><span class="ext-btn-icon">✎<small>A</small></span></button>
            </div>
        `;
        Utils.markExtNode(header);
        const heading = document.querySelector<HTMLElement>('main h1, main header h1, header h1');
        const headerContainer = heading?.closest('header') || heading?.parentElement || document.querySelector<HTMLElement>('header');
        const modeButton = headerContainer?.querySelector<HTMLElement>('button[aria-label*="mode" i],button[aria-label*=\"model\" i],button[data-testid*=\"mode\" i]');

        if (modeButton && modeButton.parentElement) {
            // Place immediately to the right of the mode selector, align with header controls.
            modeButton.insertAdjacentElement('afterend', header);
            const parent = modeButton.parentElement as HTMLElement;
            parent.style.display = 'flex';
            parent.style.alignItems = 'center';
            parent.style.gap = '10px';
            parent.style.flexWrap = 'nowrap';
            parent.style.flex = '1 1 auto';
            parent.style.minWidth = '0';
            // Allow header row to stretch across available space
            const headerRow = parent.closest('header');
            if (headerRow) {
                (headerRow as HTMLElement).style.display = 'flex';
                (headerRow as HTMLElement).style.alignItems = 'center';
                (headerRow as HTMLElement).style.gap = '10px';
            }
        } else if (heading && heading.parentElement) {
            heading.insertAdjacentElement('afterend', header);
            heading.parentElement.style.display = 'flex';
            heading.parentElement.style.alignItems = 'center';
            heading.parentElement.style.gap = '10px';
            heading.parentElement.style.flexWrap = 'wrap';
            heading.parentElement.style.flex = '1 1 auto';
        } else {
            container.parentElement?.insertBefore(header, container);
        }
        this.headerEl = header;
        this.nameEl = header.querySelector('.ext-thread-meta-name');
        this.tagsEl = header.querySelector('.ext-thread-meta-tags');
        this.noteEl = header.querySelector('.ext-thread-meta-note');
        this.sizeEl = header.querySelector('.ext-thread-meta-size');
        this.lengthEl = header.querySelector('.ext-thread-meta-length');
        this.currentThreadId = threadId;
        this.bindEditors(threadId);
        return header;
    }

    async render(threadId: string, meta: ThreadMetadata) {
        if (!this.headerEl || this.currentThreadId !== threadId) return;
        const resolvedName = meta.name || this.readPageTitle(threadId) || 'Untitled thread';
        if (!meta.name && resolvedName && resolvedName !== 'Untitled thread') {
            meta.name = resolvedName;
            await this.service.write(threadId, meta);
        }
        if (this.nameEl) this.nameEl.textContent = resolvedName;
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
        if (this.sizeEl) {
            const size = typeof meta.size === 'number' ? meta.size : null;
            this.sizeEl.textContent = size != null ? `${size} items` : '';
        }
    }

    private bindEditors(threadId: string) {
        const nameButton = this.headerEl?.querySelector<HTMLButtonElement>('.ext-thread-meta-edit-name');
        if (nameButton) {
            nameButton.onclick = () => {
                if (!this.nameEl) return;
                this.nameEl.focus();
                document.execCommand?.('selectAll', false);
            };
        }
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

    private readPageTitle(threadId: string): string | null {
        // Prefer the navigation entry that matches the current thread id for non-project conversations.
        if (threadId) {
            const navMatch = document.querySelector<HTMLElement>(`nav a[href*="/c/${threadId}"]`);
            const navText = navMatch?.textContent?.trim();
            if (navText) return navText;
        }
        const heading = document.querySelector<HTMLElement>('main h1, main header h1, header h1');
        const headingText = heading?.textContent?.trim();
        if (headingText) return headingText;
        const navCurrent = document.querySelector<HTMLElement>('nav [aria-current="page"], nav [data-active="true"], nav [aria-selected="true"]');
        const navText = navCurrent?.textContent?.trim();
        if (navText) return navText;
        const docTitle = (document.title || '').replace(/-?\s*ChatGPT.*/i, '').trim();
        return docTitle || null;
    }
}

// Expose for tests
(globalThis as any).ThreadMetadataController = ThreadMetadataController;
