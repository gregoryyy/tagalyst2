// Inline editor helpers
let activeTagEditor = null;
let activeNoteEditor = null;

/**
 * Tears down the currently open tag editor if present.
 */
function closeActiveTagEditor() {
    if (activeTagEditor) {
        activeTagEditor.cleanup();
        activeTagEditor = null;
    }
}

/**
 * Tears down the currently open note editor if present.
 */
function closeActiveNoteEditor() {
    if (activeNoteEditor) {
        activeNoteEditor.cleanup();
        activeNoteEditor = null;
    }
}

/**
 * Opens the floating tag editor for a message.
 */
async function openInlineTagEditor(messageEl, threadKey) {
    if (activeTagEditor?.message === messageEl) {
        closeActiveTagEditor();
        return;
    }
    closeActiveTagEditor();

    const key = `${threadKey}:${keyForMessage(messageEl)}`;
    const store = await getStore([key]);
    const cur = store[key] || {};
    const existing = Array.isArray(cur.tags) ? cur.tags.join(', ') : '';

    const editor = document.createElement('div');
    editor.className = 'ext-tag-editor';
    markExtNode(editor);
    editor.innerHTML = `
        <div class="ext-tag-editor-input" contenteditable="true" role="textbox" aria-label="Edit tags" data-placeholder="Add tags…"></div>
        <div class="ext-tag-editor-actions">
            <button type="button" class="ext-tag-editor-save">Save</button>
            <button type="button" class="ext-tag-editor-cancel">Cancel</button>
        </div>
    `;

    const input = editor.querySelector('.ext-tag-editor-input');
    input.textContent = existing;

    const toolbar = messageEl.querySelector('.ext-toolbar');
    const detachFloating = mountFloatingEditor(editor, toolbar || messageEl);
    messageEl.classList.add('ext-tag-editing');
    input.focus();
    placeCaretAtEnd(input);

    const cleanup = () => {
        detachFloating();
        editor.remove();
        messageEl.classList.remove('ext-tag-editing');
        if (activeTagEditor?.message === messageEl) activeTagEditor = null;
    };

    const save = async () => {
        const raw = input.innerText.replace(/\n+/g, ',');
        const tags = raw.split(',').map(s => s.trim()).filter(Boolean);
        cur.tags = tags;
        await setStore({ [key]: cur });
        renderBadges(messageEl, threadKey, cur);
        cleanup();
    };

    const cancel = () => cleanup();

    editor.querySelector('.ext-tag-editor-save').onclick = save;
    editor.querySelector('.ext-tag-editor-cancel').onclick = cancel;
    editor.addEventListener('keydown', (evt) => {
        if (evt.key === 'Escape') {
            evt.preventDefault();
            cancel();
        } else if (evt.key === 'Enter' && (evt.metaKey || evt.ctrlKey)) {
            evt.preventDefault();
            save();
        }
    });
    editor.addEventListener('mousedown', evt => evt.stopPropagation());
    const outsideTag = (evt) => {
        if (!editor.contains(evt.target)) {
            cancel();
            document.removeEventListener('mousedown', outsideTag, true);
        }
    };
    document.addEventListener('mousedown', outsideTag, true);

    activeTagEditor = { message: messageEl, cleanup };
}

/**
 * Opens the floating note editor for a message.
 */
async function openInlineNoteEditor(messageEl, threadKey) {
    if (activeNoteEditor?.message === messageEl) {
        closeActiveNoteEditor();
        return;
    }
    closeActiveNoteEditor();

    const key = `${threadKey}:${keyForMessage(messageEl)}`;
    const store = await getStore([key]);
    const cur = store[key] || {};
    const existing = typeof cur.note === 'string' ? cur.note : '';

    const editor = document.createElement('div');
    editor.className = 'ext-note-editor';
    markExtNode(editor);
    editor.innerHTML = `
        <label class="ext-note-label">
            Annotation
            <textarea class="ext-note-input" rows="3" placeholder="Add details…"></textarea>
        </label>
        <div class="ext-note-actions">
            <button type="button" class="ext-note-save">Save</button>
            <button type="button" class="ext-note-cancel">Cancel</button>
        </div>
    `;

    const input = editor.querySelector('.ext-note-input');
    input.value = existing;

    const toolbar = messageEl.querySelector('.ext-toolbar');
    const detachFloating = mountFloatingEditor(editor, toolbar || messageEl);
    messageEl.classList.add('ext-note-editing');
    input.focus();
    input.select();

    const cleanup = () => {
        detachFloating();
        editor.remove();
        messageEl.classList.remove('ext-note-editing');
        if (activeNoteEditor?.message === messageEl) activeNoteEditor = null;
    };

    const save = async () => {
        const value = input.value.trim();
        if (value) {
            cur.note = value;
        } else {
            delete cur.note;
        }
        await setStore({ [key]: cur });
        renderBadges(messageEl, threadKey, cur);
        cleanup();
    };

    const cancel = () => cleanup();

    editor.querySelector('.ext-note-save').onclick = save;
    editor.querySelector('.ext-note-cancel').onclick = cancel;
    editor.addEventListener('keydown', (evt) => {
        if (evt.key === 'Escape') {
            evt.preventDefault();
            cancel();
        } else if ((evt.metaKey || evt.ctrlKey) && evt.key === 'Enter') {
            evt.preventDefault();
            save();
        }
    });
    editor.addEventListener('mousedown', evt => evt.stopPropagation());
    const outsideNote = (evt) => {
        if (!editor.contains(evt.target)) {
            cancel();
            document.removeEventListener('mousedown', outsideNote, true);
        }
    };
    document.addEventListener('mousedown', outsideNote, true);

    activeNoteEditor = { message: messageEl, cleanup };
}

/**
 * Places the caret at the end of a contentEditable element.
 */
function placeCaretAtEnd(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
}

/**
 * Positions an editor relative to an anchor and keeps it synced.
 */
function mountFloatingEditor(editor, anchor) {
    editor.classList.add('ext-floating-editor');
    markExtNode(editor);
    document.body.appendChild(editor);

    const clamp = (val, min, max) => Math.min(Math.max(val, min), max);

    const update = () => {
        const rect = anchor.getBoundingClientRect();
        const width = Math.min(420, window.innerWidth - 32);
        editor.style.width = `${width}px`;
        const baseTop = window.scrollY + rect.top + 16;
        const maxTop = window.scrollY + window.innerHeight - editor.offsetHeight - 16;
        const top = clamp(baseTop, window.scrollY + 16, maxTop);
        const baseLeft = window.scrollX + rect.right - width;
        const minLeft = window.scrollX + 16;
        const maxLeft = window.scrollX + window.innerWidth - width - 16;
        const left = clamp(baseLeft, minLeft, maxLeft);
        editor.style.top = `${top}px`;
        editor.style.left = `${left}px`;
    };

    const onScroll = () => update();
    const onResize = () => update();

    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    update();

    return () => {
        window.removeEventListener('scroll', onScroll, true);
        window.removeEventListener('resize', onResize);
        editor.classList.remove('ext-floating-editor');
    };
}
