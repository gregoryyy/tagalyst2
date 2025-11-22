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
    private charsEl: HTMLElement | null = null;
    private titleMarkerEl: HTMLElement | null = null;
    private projectEl: HTMLElement | null = null;
    private starButton: HTMLButtonElement | null = null;
    private currentThreadId: string | null = null;
    private isEditingName = false;
    private titleRefreshTimer: number | null = null;

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
            <div class="ext-thread-meta-left" style="display:flex;flex-direction:column;gap:0;flex:1 1 auto;min-width:0;">
                <div class="ext-thread-meta-project" style="font-size:11px;color:#555;font-weight:600;line-height:1.2;display:none;"></div>
                <div class="ext-thread-meta-name" contenteditable="true" aria-label="Thread name" style="font-size:15px;font-weight:600;line-height:1.3;"></div>
                <div class="ext-thread-meta-sub" style="display:flex;flex-wrap:wrap;gap:6px;font-size:12px;color:#444;align-items:center;margin-top:-2px;">
                    <span class="ext-thread-meta-length"></span>
                    <span class="ext-thread-meta-size"></span>
                    <span class="ext-thread-meta-chars"></span>
                    <span class="ext-thread-meta-tags"></span>
                    <span class="ext-thread-meta-note"></span>
                    <span class="ext-thread-meta-title-changed" style="display:none;color:#2b7a0b;font-weight:600;">Title changed</span>
                </div>
            </div>
            <div class="ext-thread-meta-right ext-toolbar" style="display:flex;gap:6px;flex-shrink:0;padding:0;border:none;box-shadow:none;background:transparent;">
                <button type="button" class="ext-thread-meta-edit-name" title="Edit title (C)"><span class="ext-btn-icon">✎<small>C</small></span></button>
                <button type="button" class="ext-thread-meta-edit-tags" title="Edit tags (T)"><span class="ext-btn-icon">✎<small>T</small></span></button>
                <button type="button" class="ext-thread-meta-edit-note" title="Edit annotation (A)"><span class="ext-btn-icon">✎<small>A</small></span></button>
                <button type="button" class="ext-thread-meta-star" title="Star thread" aria-pressed="false"><span class="ext-btn-icon" style="transform: translate(0,0);">☆</span></button>
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
        this.charsEl = header.querySelector('.ext-thread-meta-chars');
        this.titleMarkerEl = header.querySelector('.ext-thread-meta-title-changed');
        this.projectEl = header.querySelector('.ext-thread-meta-project');
        this.starButton = header.querySelector('.ext-thread-meta-star');
        this.currentThreadId = threadId;
        this.bindEditors(threadId);
        return header;
    }

    async render(threadId: string, meta: ThreadMetadata) {
        if (!this.headerEl || this.currentThreadId !== threadId) return;
        const pageInfo = this.readPageInfo(threadId);
        const pageTitle = pageInfo.threadTitle;
        const resolvedName = meta.name || pageTitle || 'Untitled thread';
        if (!meta.name && !pageTitle) {
            this.scheduleTitleRefresh(threadId);
        }
        if (!this.isEditingName) {
            if (!meta.name && resolvedName && resolvedName !== 'Untitled thread') {
                meta.name = resolvedName;
                await this.service.write(threadId, meta);
            }
            if (this.nameEl) this.nameEl.textContent = resolvedName;
        }
        if (this.projectEl) {
            if (pageInfo.projectTitle) {
                this.projectEl.textContent = pageInfo.projectTitle;
                this.projectEl.style.display = 'inline';
            } else {
                this.projectEl.style.display = 'none';
                this.projectEl.textContent = '';
            }
        }
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
            this.lengthEl.textContent = `${count} prompt${count === 1 ? '' : 's'}`;
        }
        if (this.sizeEl) {
            const size = typeof meta.size === 'number' ? meta.size : null;
            this.sizeEl.textContent = size != null ? `${size} items` : '';
        }
        if (this.charsEl) {
            const chars = typeof meta.chars === 'number' ? meta.chars : null;
            if (chars != null) {
                const formatted = this.formatLength(chars);
                this.charsEl.textContent = formatted;
                this.charsEl.setAttribute('title', `${chars.toLocaleString()} characters`);
                this.charsEl.setAttribute('aria-label', `${chars.toLocaleString()} characters`);
            } else {
                this.charsEl.textContent = '';
                this.charsEl.removeAttribute('title');
                this.charsEl.removeAttribute('aria-label');
            }
        }
        if (this.titleMarkerEl) {
            const changed = !!meta.name && meta.name !== pageTitle;
            this.titleMarkerEl.style.display = changed ? 'inline-flex' : 'none';
        }
        if (this.starButton) {
            const starred = !!meta.starred;
            this.starButton.setAttribute('aria-pressed', starred ? 'true' : 'false');
            const icon = this.starButton.querySelector<HTMLElement>('.ext-btn-icon');
            if (icon) icon.textContent = starred ? '★' : '☆';
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
            this.nameEl.addEventListener('focus', () => { this.isEditingName = true; });
            this.nameEl.addEventListener('blur', () => this.saveName(threadId));
            this.nameEl.addEventListener('keydown', (evt) => {
                if (evt.key === 'Enter') {
                    evt.preventDefault();
                    this.saveName(threadId);
                }
            });
        }
        if (this.starButton) {
            this.starButton.onclick = async () => {
                const meta = await this.service.read(threadId);
                meta.starred = !meta.starred;
                await this.service.write(threadId, meta);
                this.render(threadId, meta);
            };
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
        this.isEditingName = false;
        this.render(threadId, meta);
    }

    private scheduleTitleRefresh(threadId: string) {
        if (this.titleRefreshTimer) {
            clearTimeout(this.titleRefreshTimer);
        }
        this.titleRefreshTimer = window.setTimeout(async () => {
            this.titleRefreshTimer = null;
            if (this.isEditingName || this.currentThreadId !== threadId) return;
            const meta = await this.service.read(threadId);
            if (meta.name) return;
            const refreshed = this.readPageInfo(threadId).threadTitle;
            if (refreshed && refreshed !== 'Untitled thread') {
                meta.name = refreshed;
                await this.service.write(threadId, meta);
                this.render(threadId, meta);
            }
        }, 800);
    }

    private readPageInfo(threadId: string): { threadTitle: string | null; projectTitle: string | null } {
        const path = location.pathname || '';
        const inProject = path.includes('/g/');
        const projectIdMatch = path.match(/\/g\/([^/]+)/);
        const projectId = projectIdMatch ? projectIdMatch[1] : null;
        let threadTitle: string | null = null;
        let projectTitle: string | null = null;

        if (threadId) {
            const navMatch = document.querySelector<HTMLElement>(`nav a[href*="/c/${threadId}"]`);
            const navText = navMatch?.textContent?.trim() || null;
            if (navText) {
                if (inProject && navText.includes('•')) {
                    const parts = navText.split('•').map(p => p.trim()).filter(Boolean);
                    if (parts.length >= 2) {
                        projectTitle = parts[0];
                        threadTitle = parts.slice(1).join(' • ');
                    } else {
                        threadTitle = navText;
                    }
                } else {
                    threadTitle = navText;
                }
            }
        }

        if (inProject && !projectTitle) {
            const selector = projectId
                ? `nav a[href*="/g/${projectId}"]`
                : 'nav a[href*="/g/"]';
            const projectLink = document.querySelector<HTMLElement>(selector) ||
                document.querySelector<HTMLElement>('nav a[href*="/project"]');
            const text = projectLink?.textContent?.trim();
            if (text) projectTitle = text;
        }

        if (!threadTitle) {
            const navCurrent = document.querySelector<HTMLElement>('nav [aria-current="page"], nav [data-active="true"], nav [aria-selected="true"]');
            const navText = navCurrent?.textContent?.trim();
            if (navText) threadTitle = navText;
        }

        if (!threadTitle) {
            const docTitle = (document.title || '').replace(/-?\s*ChatGPT.*/i, '').trim();
            if (docTitle) threadTitle = docTitle;
        }

        return { threadTitle, projectTitle };
    }

    private formatLength(length: number) {
        if (length >= 1000) {
            const value = length >= 10000 ? Math.round(length / 1000) : Math.round(length / 100) / 10;
            return `${value}k chars`;
        }
        return `${length} chars`;
    }
}

// Expose for tests
(globalThis as any).ThreadMetadataController = ThreadMetadataController;
