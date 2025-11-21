/**
 * Manages floating editors for tags and notes attached to messages.
 */
class EditorController {
    private activeTagEditor: ActiveEditor | null = null;
    private activeNoteEditor: ActiveEditor | null = null;

    constructor(private readonly storage: StorageService) { }

    /**
     * Tears down any active editors.
     */
    teardown() {
        this.closeTagEditor();
        this.closeNoteEditor();
    }

    /**
     * Closes the tag editor if open.
     */
    private closeTagEditor() {
        if (this.activeTagEditor) {
            this.activeTagEditor.cleanup();
            this.activeTagEditor = null;
        }
    }

    /**
     * Closes the note editor if open.
     */
    private closeNoteEditor() {
        if (this.activeNoteEditor) {
            this.activeNoteEditor.cleanup();
            this.activeNoteEditor = null;
        }
    }

    /**
     * Opens the floating tag editor for the specified message.
     */
    async openTagEditor(messageEl: HTMLElement, threadKey: string) {
        if (this.activeTagEditor?.message === messageEl) {
            this.closeTagEditor();
            return;
        }
        this.closeTagEditor();

        const adapter = messageMetaRegistry.resolveAdapter(messageEl);
        const cur = await this.storage.readMessage(threadKey, adapter);
        if (Array.isArray(cur.tags)) {
            cur.tags = cur.tags.map(tag => tag.toLowerCase());
        }
        const existing = Array.isArray(cur.tags) ? cur.tags.join(', ') : '';

        const editor = document.createElement('div');
        editor.className = 'ext-tag-editor';
        Utils.markExtNode(editor);
        editor.innerHTML = `
            <div class="ext-tag-editor-input" contenteditable="true" role="textbox" aria-label="Edit tags" data-placeholder="Add tags…"></div>
            <div class="ext-tag-editor-actions">
                <button type="button" class="ext-tag-editor-save">Save</button>
                <button type="button" class="ext-tag-editor-cancel">Cancel</button>
            </div>
        `;

        const input = editor.querySelector<HTMLElement>('.ext-tag-editor-input');
        if (!input) return;
        input.textContent = existing;

        const toolbar = messageEl.querySelector<HTMLElement>('.ext-toolbar');
        const detachFloating = Utils.mountFloatingEditor(editor, (toolbar || messageEl) as HTMLElement);
        messageEl.classList.add('ext-tag-editing');
        input.focus();
        Utils.placeCaretAtEnd(input);

        const cleanup = () => {
            detachFloating();
            editor.remove();
            messageEl.classList.remove('ext-tag-editing');
            if (this.activeTagEditor?.message === messageEl) this.activeTagEditor = null;
        };

        const save = async () => {
            const raw = input.innerText.replace(/\n+/g, ',');
            const tags = raw.split(',').map(s => s.trim()).filter(Boolean);
            cur.tags = tags.map(tag => tag.toLowerCase());
            await this.storage.writeMessage(threadKey, adapter, cur);
            toolbarController.updateBadges(messageEl, threadKey, cur, adapter);
            cleanup();
        };

        const cancel = () => cleanup();

        const saveBtn = editor.querySelector<HTMLButtonElement>('.ext-tag-editor-save');
        const cancelBtn = editor.querySelector<HTMLButtonElement>('.ext-tag-editor-cancel');
        if (saveBtn) saveBtn.onclick = save;
        if (cancelBtn) cancelBtn.onclick = cancel;
        editor.addEventListener('keydown', (evt) => {
            if (evt.key === 'Escape') {
                evt.preventDefault();
                cancel();
            } else if (evt.key === 'Enter' && !evt.shiftKey) {
                evt.preventDefault();
                save();
            }
        });
        editor.addEventListener('mousedown', evt => evt.stopPropagation());
        const outsideTag = (evt: MouseEvent) => {
            if (!editor.contains(evt.target as Node)) {
                cancel();
                document.removeEventListener('mousedown', outsideTag, true);
            }
        };
        document.addEventListener('mousedown', outsideTag, true);

        this.activeTagEditor = { message: messageEl, cleanup };
    }

    /**
     * Generic floating text editor used for notes/annotations.
     */
    openTextEditor(opts: {
        anchor: HTMLElement;
        value: string;
        placeholder?: string;
        title?: string;
        saveOnEnter?: boolean;
        saveOnCtrlEnter?: boolean;
        onSave: (value: string) => Promise<void> | void;
        onCancel?: () => void;
        onCleanup?: () => void;
    }) {
        const editor = document.createElement('div');
        editor.className = 'ext-note-editor';
        Utils.markExtNode(editor);
        editor.innerHTML = `
            <label class="ext-note-label">
                ${opts.title || 'Annotation'}
                <textarea class="ext-note-input" rows="3" placeholder="${opts.placeholder || 'Add details…'}"></textarea>
            </label>
            <div class="ext-note-actions">
                <button type="button" class="ext-note-save">Save</button>
                <button type="button" class="ext-note-cancel">Cancel</button>
            </div>
        `;
        const input = editor.querySelector<HTMLTextAreaElement>('.ext-note-input');
        if (!input) return () => { editor.remove(); };
        input.value = opts.value || '';
        const detachFloating = Utils.mountFloatingEditor(editor, opts.anchor);
        const cleanup = () => {
            detachFloating();
            editor.remove();
            opts.onCleanup?.();
        };
        const save = async () => {
            await opts.onSave(input.value || '');
            cleanup();
        };
        const cancel = () => {
            opts.onCancel?.();
            cleanup();
        };
        const saveBtn = editor.querySelector<HTMLButtonElement>('.ext-note-save');
        const cancelBtn = editor.querySelector<HTMLButtonElement>('.ext-note-cancel');
        if (saveBtn) saveBtn.onclick = save;
        if (cancelBtn) cancelBtn.onclick = cancel;
        editor.addEventListener('keydown', (evt) => {
            if (evt.key === 'Escape') {
                evt.preventDefault();
                cancel();
            } else if (opts.saveOnEnter && evt.key === 'Enter' && !evt.shiftKey && !evt.metaKey && !evt.ctrlKey && !evt.altKey) {
                evt.preventDefault();
                save();
            } else if (opts.saveOnCtrlEnter && (evt.metaKey || evt.ctrlKey) && evt.key === 'Enter') {
                evt.preventDefault();
                save();
            }
        });
        editor.addEventListener('mousedown', evt => evt.stopPropagation());
        const outside = (evt: MouseEvent) => {
            if (!editor.contains(evt.target as Node)) {
                cancel();
                document.removeEventListener('mousedown', outside, true);
            }
        };
        document.addEventListener('mousedown', outside, true);
        input.focus();
        input.select();
        return cleanup;
    }

    /**
     * Opens the floating note editor for the specified message.
     */
    async openNoteEditor(messageEl: HTMLElement, threadKey: string) {
        if (this.activeNoteEditor?.message === messageEl) {
            this.closeNoteEditor();
            return;
        }
        this.closeNoteEditor();

        const adapter = messageMetaRegistry.resolveAdapter(messageEl);
        const cur = await this.storage.readMessage(threadKey, adapter);
        const existing = typeof cur.note === 'string' ? cur.note : '';
        const toolbar = messageEl.querySelector<HTMLElement>('.ext-toolbar');
        const anchor = (toolbar || messageEl) as HTMLElement;

        const cleanup = this.openTextEditor({
            anchor,
            value: existing,
            placeholder: 'Add details…',
            title: 'Annotation',
            saveOnCtrlEnter: true,
            onSave: async (value: string) => {
                const trimmed = value.trim();
                if (trimmed) {
                    cur.note = trimmed;
                } else {
                    delete cur.note;
                }
                await this.storage.writeMessage(threadKey, adapter, cur);
                toolbarController.updateBadges(messageEl, threadKey, cur, adapter);
            },
            onCleanup: () => {
                messageEl.classList.remove('ext-note-editing');
                if (this.activeNoteEditor?.message === messageEl) this.activeNoteEditor = null;
            },
        });
        messageEl.classList.add('ext-note-editing');
        this.activeNoteEditor = { message: messageEl, cleanup };
    }
} // EditorController

type HighlightEntry = {
    id: string;
    start: number;
    end: number;
    text: string;
    annotation?: string;
};

type HighlightRange = {
    range: Range;
    rects: DOMRect[];
};

/**
 * Handles CSS highlighter interactions, selection menus, and hover annotations.
 */
