// ------------------------ Inline Editors ------------------------
let tagListEl = null;
let topPanelsEl = null;
let searchInputEl = null;

const FOCUS_MODES = Object.freeze({
    STARS: 'stars',
    TAGS: 'tags',
    SEARCH: 'search',
});

const focusGlyphs = {
    [FOCUS_MODES.STARS]: { empty: '☆', filled: '★' },
    [FOCUS_MODES.TAGS]: { empty: '○', filled: '●' },
    [FOCUS_MODES.SEARCH]: { empty: '□', filled: '■' },
};

const focusState = {
    mode: FOCUS_MODES.STARS,
    selectedTags: new Set(),
    searchQuery: '',
    searchQueryLower: '',
};

const messageState = new Map();
let pageControls = null;
let focusNavIndex = -1;

/**
 * Locates the primary ChatGPT transcript container element.
 */
function findTranscriptRoot() {
    const main = document.querySelector('main') || document.body;
    const candidates = Array.from(main.querySelectorAll('*')).filter(el => {
        const s = getComputedStyle(el);
        const scrollable = s.overflowY === 'auto' || s.overflowY === 'scroll';
        return scrollable && el.clientHeight > 300 && el.children.length > 1;
    });
    // Pick the largest scrollable area; fallback to main
    return (candidates.sort((a, b) => b.clientHeight - a.clientHeight)[0]) || main;
}

/**
 * Heuristic to determine if a DOM node is a ChatGPT message block.
 */
function isMessageNode(el) {
    if (!el || !el.parentElement) return false;
    if (el.querySelector('form, textarea, [contenteditable="true"]')) return false; // composer region
    const textLen = (el.innerText || '').trim().length;
    if (textLen < 8) return false;
    // Heuristics: rich text or code, and likely large block
    return !!el.querySelector('pre, code, p, li, h1, h2, h3') || textLen > 80;
}

/**
 * Returns all message nodes within the current transcript.
 */
function enumerateMessages(root) {
    const attrMatches = Array.from(root.querySelectorAll('[data-message-author-role]'));
    if (attrMatches.length) return attrMatches;

    // Fallback to heuristic block detection if the explicit attribute is absent.
    const out = [];
    for (const child of root.children) {
        if (isMessageNode(child)) out.push(child);
    }
    return out;
}

/**
 * Groups messages into (prompt,response) pairs for convenience.
 */
function derivePairs(messages) {
    const pairs = [];
    for (let i = 0; i < messages.length; i += 2) {
        const query = messages[i];
        if (!query) break;
        const response = messages[i + 1] || null;
        pairs.push({
            query,
            response,
            queryId: getMessageId(query),
            responseId: response ? getMessageId(response) : null,
        });
    }
    return pairs;
}

/**
 * Gets every (prompt,response) pair found in the thread container.
 */
function getPairs(root) {
    return derivePairs(enumerateMessages(root));
}

/**
 * Returns the prompt nodes from each pair, skipping empty slots.
 */
function getPromptNodes(root) {
    return getPairs(root).map(p => p.query).filter(Boolean);
}

/**
 * Provides the node set used for navigation controls (prompts or all messages).
 */
function getNavigationNodes(root) {
    const prompts = getPromptNodes(root);
    if (prompts.length) return prompts;
    return enumerateMessages(root);
}

/**
 * Retrieves the idx-th pair (0-based) if it exists.
 */
function getPair(root, idx) {
    if (idx < 0) return null;
    return getPairs(root)[idx] || null;
}

// ---------------------- UI Injection ---------------------------
/**
 * Renders global navigation/collapse/export controls for a thread.
 */
function ensurePageControls(container, threadKey) {
    const existing = document.getElementById('ext-page-controls');
    if (existing) existing.remove();
    const box = document.createElement('div');
    box.id = 'ext-page-controls';
    markExtNode(box);
    box.innerHTML = `
    <div class="ext-nav-frame">
        <span class="ext-nav-label">Navigate</span>
        <div class="ext-nav-buttons">
            <button id="ext-jump-first" title="Jump to first prompt">⤒</button>
            <button id="ext-jump-last" title="Jump to last prompt">⤓</button>
        </div>
        <div class="ext-nav-buttons">
            <button id="ext-jump-star-prev" title="Previous starred message">★↑</button>
            <button id="ext-jump-star-next" title="Next starred message">★↓</button>
        </div>
    </div>
    <div class="ext-batch-frame">
        <span class="ext-nav-label">Collapse</span>
        <div class="ext-batch-buttons">
            <button id="ext-collapse-all" title="Collapse all prompts">All</button>
            <button id="ext-collapse-unstarred" title="Collapse unstarred prompts">☆</button>
        </div>
    </div>
    <div class="ext-batch-frame">
        <span class="ext-nav-label">Expand</span>
        <div class="ext-batch-buttons">
            <button id="ext-expand-all" title="Expand all prompts">All</button>
            <button id="ext-expand-starred" title="Expand starred prompts">★</button>
        </div>
    </div>
    <div class="ext-export-frame">
        <span class="ext-nav-label">MD Copy</span>
        <div class="ext-export-buttons">
            <button id="ext-export-all" class="ext-export-button">All</button>
            <button id="ext-export-starred" class="ext-export-button">★</button>
        </div>
    </div>
  `;
    document.documentElement.appendChild(box);
    syncTopPanelWidth();

    function scrollToNode(idx, block = 'center', list) {
        const nodes = list || getNavigationNodes(container);
        if (!nodes.length) return;
        const clamped = Math.max(0, Math.min(idx, nodes.length - 1));
        const target = nodes[clamped];
        if (target) target.scrollIntoView({ behavior: 'smooth', block });
    }

    function scrollFocus(delta) {
        const nodes = getFocusMatches();
        if (!nodes.length) return;
        if (focusNavIndex < 0 || focusNavIndex >= nodes.length) {
            focusNavIndex = delta >= 0 ? 0 : nodes.length - 1;
        } else {
            focusNavIndex = Math.max(0, Math.min(focusNavIndex + delta, nodes.length - 1));
        }
        const target = nodes[focusNavIndex];
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    box.querySelector('#ext-jump-first').onclick = () => scrollToNode(0, 'start');
    box.querySelector('#ext-jump-last').onclick = () => {
        const nodes = getNavigationNodes(container);
        if (!nodes.length) return;
        scrollToNode(nodes.length - 1, 'end', nodes);
    };
    box.querySelector('#ext-jump-star-prev').onclick = () => { scrollFocus(-1); };
    box.querySelector('#ext-jump-star-next').onclick = () => { scrollFocus(1); };
    box.querySelector('#ext-collapse-all').onclick = () => toggleAll(container, true);
    box.querySelector('#ext-collapse-unstarred').onclick = () => collapseByFocus(container, 'out', true);
    box.querySelector('#ext-expand-all').onclick = () => toggleAll(container, false);
    box.querySelector('#ext-expand-starred').onclick = () => collapseByFocus(container, 'in', false);

    box.querySelector('#ext-export-all').onclick = () => runExport(container, false);
    box.querySelector('#ext-export-starred').onclick = () => runExport(container, true);

    pageControls = {
        root: box,
        focusPrev: box.querySelector('#ext-jump-star-prev'),
        focusNext: box.querySelector('#ext-jump-star-next'),
        collapseNonFocus: box.querySelector('#ext-collapse-unstarred'),
        expandFocus: box.querySelector('#ext-expand-starred'),
        exportFocus: box.querySelector('#ext-export-starred'),
    };
    updateFocusControlsUI();
}

/**
 * Adds the per-message toolbar (tags, notes, star, collapse, etc.).
 */
function injectToolbar(el, threadKey) {
    let toolbar = el.querySelector('.ext-toolbar');
    if (toolbar) {
        if (toolbar.dataset.threadKey !== threadKey) {
            toolbar.closest('.ext-toolbar-row')?.remove();
            toolbar = null;
        } else {
            updateCollapseVisibility(el);
            return; // already wired for this thread
        }
    }

    const row = document.createElement('div');
    row.className = 'ext-toolbar-row';
    markExtNode(row);
    const wrap = document.createElement('div');
    wrap.className = 'ext-toolbar';
    markExtNode(wrap);
    wrap.innerHTML = `
    <span class="ext-badges"></span>
    <button class="ext-tag" title="Edit tags" aria-label="Edit tags"><span class="ext-btn-icon">✎<small>T</small></span></button>
    <button class="ext-note" title="Add annotation" aria-label="Add annotation"><span class="ext-btn-icon">✎<small>A</small></span></button>
    <button class="ext-focus-button" title="Bookmark" aria-pressed="false">☆</button>
    <button class="ext-collapse" title="Collapse message" aria-expanded="true" aria-label="Collapse message">−</button>
  `;
    row.appendChild(wrap);

    // Events
    wrap.querySelector('.ext-collapse').onclick = () => collapse(el, !el.classList.contains('ext-collapsed'));
    wrap.querySelector('.ext-focus-button').onclick = async () => {
        if (focusState.mode !== FOCUS_MODES.STARS) return;
        const k = `${threadKey}:${keyForMessage(el)}`;
        const cur = (await getStore([k]))[k] || {};
        cur.starred = !cur.starred;
        await setStore({ [k]: cur });
        renderBadges(el, threadKey, cur);
        updateFocusControlsUI();
    };
    wrap.querySelector('.ext-tag').onclick = () => openInlineTagEditor(el, threadKey);
    wrap.querySelector('.ext-note').onclick = () => openInlineNoteEditor(el, threadKey);

    wrap.dataset.threadKey = threadKey;
    el.prepend(row);
    toolbar = wrap;
    ensureUserToolbarButton(el);
    updateCollapseVisibility(el);
    syncCollapseButton(el);
}

/**
 * Updates tag/note badges and focus button state for a message.
 */
function renderBadges(el, threadKey, value) {
    const k = `${threadKey}:${keyForMessage(el)}`;
    const cur = value || {};
    setMessageMeta(el, { key: k, value: cur });
    const badges = el.querySelector('.ext-badges');
    if (!badges) return;

    // starred visual state
    const starred = !!cur.starred;
    el.classList.toggle('ext-starred', starred);

    // render tags
    badges.innerHTML = '';
    const tags = Array.isArray(cur.tags) ? cur.tags : [];
    for (const t of tags) {
        const span = document.createElement('span');
        span.className = 'ext-badge';
        span.textContent = t;
        badges.appendChild(span);
    }

    const note = typeof cur.note === 'string' ? cur.note.trim() : '';
    if (note) {
        const noteChip = document.createElement('span');
        noteChip.className = 'ext-note-pill';
        noteChip.textContent = note.length > 80 ? `${note.slice(0, 77)}…` : note;
        noteChip.title = note;
        badges.appendChild(noteChip);
    }
    updateFocusButton(el, cur);
}

/**
 * Collapses or expands an individual message element.
 */
function collapse(el, yes) {
    el.classList.toggle('ext-collapsed', !!yes);
    syncCollapseButton(el);
}

/**
 * Collapses or expands every discovered message in the container.
 */
function toggleAll(container, yes) {
    const msgs = enumerateMessages(container);
    for (const m of msgs) collapse(m, !!yes);
}

/**
 * Applies collapse state to nodes based on whether they match focus.
 */
function collapseByFocus(container, target, collapseState) {
    const matches = getFocusMatches();
    if (!matches.length) return;
    const matchSet = new Set(matches);
    for (const el of enumerateMessages(container)) {
        const isMatch = matchSet.has(el);
        if (target === 'in' ? isMatch : !isMatch) {
            collapse(el, collapseState);
        }
    }
}
