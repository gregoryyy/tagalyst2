/**
 * Tagalyst 2: ChatGPT DOM Tools — content script (MV3)
 * - Defensive discovery with MutationObserver
 * - Non-destructive overlays (no reparenting site nodes)
 * - Local persistence via chrome.storage
 */

// -------------------------- Utilities --------------------------
/**
 * Small helper for delaying async flows without blocking the UI thread.
 */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Produces a deterministic 32-bit FNV-1a hash for lightweight keys.
 */
function hashString(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
    }
    return ("0000000" + h.toString(16)).slice(-8);
}

/**
 * Strips excess whitespace and zero-width chars so hashes stay stable.
 */
function normalizeText(t) {
    return (t || "")
        .replace(/\s+/g, " ")
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .trim();
}

/**
 * Generates a thread-level key using the conversation ID when available.
 */
function getThreadKey() {
    // Prefer URL path (conversation id). Fallback to title + domain.
    try {
        const u = new URL(location.href);
        if (u.pathname && u.pathname.length > 1) return u.pathname.replace(/\W+/g, "-");
    } catch { }
    return hashString(document.title + location.host);
}

/**
 * Returns the DOM-provided message UUID if available.
 */
function getMessageId(el) {
    return el?.getAttribute?.('data-message-id') || null;
}

/**
 * Stable-ish per-message key derived from ChatGPT IDs or fallback heuristics.
 */
function keyForMessage(el) {
    const domId = getMessageId(el);
    if (domId) return domId;
    const text = normalizeText(el.innerText).slice(0, 4000); // perf cap
    const idx = Array.prototype.indexOf.call(el.parentElement?.children || [], el);
    return hashString(text + "|" + idx);
}

/**
 * Determines whether the collapse control should be shown for a message.
 * Hidden for single-line prompts (no line breaks).
 */
function shouldShowCollapseControl(el) {
    const text = (el.innerText || '').trim();
    if (!text) return false;
    return text.includes('\n');
}

/**
 * Promise-wrapped chrome.storage.local get.
 */
async function getStore(keys) {
    return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

/**
 * Promise-wrapped chrome.storage.local set.
 */
async function setStore(obj) {
    return new Promise(resolve => chrome.storage.local.set(obj, resolve));
}

// ------------------------ Tag Editor UI ------------------------
let activeTagEditor = null;

function closeActiveTagEditor() {
    if (activeTagEditor) {
        activeTagEditor.cleanup();
        activeTagEditor = null;
    }
}

function teardownUI() {
    closeActiveTagEditor();
    document.querySelectorAll('.ext-tag-editor').forEach(editor => editor.remove());
    document.querySelectorAll('.ext-toolbar').forEach(tb => tb.remove());
    document.querySelectorAll('.ext-tag-editing').forEach(el => el.classList.remove('ext-tag-editing'));
    const controls = document.getElementById('ext-page-controls');
    if (controls) controls.remove();
    if (bootstrap._observer) {
        bootstrap._observer.disconnect();
        bootstrap._observer = null;
    }
}

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
    (toolbar || messageEl).after(editor);
    messageEl.classList.add('ext-tag-editing');
    input.focus();
    placeCaretAtEnd(input);

    const cleanup = () => {
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

    activeTagEditor = { message: messageEl, cleanup };
}

function placeCaretAtEnd(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
}

// --------------------- Discovery & Enumeration -----------------
/**
 * Finds the primary scrollable container that holds the conversation.
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
 * Heuristic message detector used only when the explicit role attribute is absent.
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
 * Returns all message nodes, preferring the native role attribute.
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
 * Groups message DOM nodes into ordered (query, response) pairs.
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
 * Returns every (query, response) pair within the current thread container.
 */
function getPairs(root) {
    return derivePairs(enumerateMessages(root));
}

/**
 * Returns only the prompt (user query) nodes.
 */
function getPromptNodes(root) {
    return getPairs(root).map(p => p.query).filter(Boolean);
}

/**
 * Returns nodes used for navigation (prompts when available, otherwise all messages).
 */
function getNavigationNodes(root) {
    const prompts = getPromptNodes(root);
    if (prompts.length) return prompts;
    return enumerateMessages(root);
}

/**
 * Returns the p-th pair (0-indexed) or null if it does not exist.
 */
function getPair(root, idx) {
    if (idx < 0) return null;
    return getPairs(root)[idx] || null;
}

// ---------------------- UI Injection ---------------------------
/**
 * Injects global page controls once per document.
 */
function ensurePageControls(container, threadKey) {
    const existing = document.getElementById('ext-page-controls');
    if (existing) existing.remove();
    const box = document.createElement('div');
    box.id = 'ext-page-controls';
    box.innerHTML = `
    <div class="ext-nav-frame">
        <span class="ext-nav-label">Navigate</span>
        <div class="ext-nav-buttons">
            <button id="ext-jump-first" title="Jump to first prompt">⤒</button>
            <button id="ext-jump-last" title="Jump to last prompt">⤓</button>
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
  `;
    document.documentElement.appendChild(box);

    function scrollToNode(idx, block = 'center', list) {
        const nodes = list || getNavigationNodes(container);
        if (!nodes.length) return;
        const clamped = Math.max(0, Math.min(idx, nodes.length - 1));
        const target = nodes[clamped];
        if (target) target.scrollIntoView({ behavior: 'smooth', block });
    }

    box.querySelector('#ext-jump-first').onclick = () => scrollToNode(0, 'start');
    box.querySelector('#ext-jump-last').onclick = () => {
        const nodes = getNavigationNodes(container);
        if (!nodes.length) return;
        scrollToNode(nodes.length - 1, 'end', nodes);
    };
    box.querySelector('#ext-collapse-all').onclick = () => toggleAll(container, true);
    box.querySelector('#ext-collapse-unstarred').onclick = () => toggleByStar(container, threadKey, false, true);
    box.querySelector('#ext-expand-all').onclick = () => toggleAll(container, false);
    box.querySelector('#ext-expand-starred').onclick = () => toggleByStar(container, threadKey, true, false);
}

/**
 * Prepends the per-message toolbar and wires its handlers.
 */
function injectToolbar(el, threadKey) {
    let toolbar = el.querySelector('.ext-toolbar');
    if (toolbar) {
        if (toolbar.dataset.threadKey !== threadKey) {
            toolbar.remove();
            toolbar = null;
        } else {
            updateCollapseVisibility(el);
            return; // already wired for this thread
        }
    }

    const wrap = document.createElement('div');
    wrap.className = 'ext-toolbar';
    wrap.innerHTML = `
    <span class="ext-badges"></span>
    <button class="ext-tag" title="Edit tags" aria-label="Edit tags">✎</button>
    <button class="ext-star" title="Bookmark" aria-pressed="false">☆</button>
    <button class="ext-collapse" title="Collapse message" aria-expanded="true" aria-label="Collapse message">−</button>
  `;

    // Events
    wrap.querySelector('.ext-collapse').onclick = () => collapse(el, !el.classList.contains('ext-collapsed'));
    wrap.querySelector('.ext-star').onclick = async () => {
        const k = `${threadKey}:${keyForMessage(el)}`;
        const cur = (await getStore([k]))[k] || {};
        cur.starred = !cur.starred;
        await setStore({ [k]: cur });
        renderBadges(el, threadKey, cur);
    };
    wrap.querySelector('.ext-tag').onclick = () => openInlineTagEditor(el, threadKey);

    wrap.dataset.threadKey = threadKey;
    el.prepend(wrap);
    toolbar = wrap;
    updateCollapseVisibility(el);
    syncCollapseButton(el);
}

/**
 * Reads star/tag data for a message and updates its badges + CSS state.
 */
async function renderBadges(el, threadKey, value) {
    const k = `${threadKey}:${keyForMessage(el)}`;
    const cur = value || (await getStore([k]))[k] || {};
    const badges = el.querySelector('.ext-badges');
    if (!badges) return;

    // starred visual state
    const starred = !!cur.starred;
    el.classList.toggle('ext-starred', starred);
    const starBtn = el.querySelector('.ext-toolbar .ext-star');
    if (starBtn) {
        starBtn.textContent = starred ? '★' : '☆';
        starBtn.setAttribute('aria-pressed', String(starred));
    }

    // render tags
    badges.innerHTML = '';
    const tags = Array.isArray(cur.tags) ? cur.tags : [];
    for (const t of tags) {
        const span = document.createElement('span');
        span.className = 'ext-badge';
        span.textContent = t;
        badges.appendChild(span);
    }
}

function updateCollapseVisibility(el) {
    const btn = el.querySelector('.ext-toolbar .ext-collapse');
    if (!btn) return;
    const show = shouldShowCollapseControl(el);
    btn.style.display = show ? '' : 'none';
}

function syncCollapseButton(el) {
    const btn = el.querySelector('.ext-toolbar .ext-collapse');
    if (!btn) return;
    const collapsed = el.classList.contains('ext-collapsed');
    btn.textContent = collapsed ? '+' : '−';
    btn.setAttribute('title', collapsed ? 'Expand message' : 'Collapse message');
    btn.setAttribute('aria-label', collapsed ? 'Expand message' : 'Collapse message');
    btn.setAttribute('aria-expanded', String(!collapsed));
}

/**
 * Toggles the collapsed state for one message block.
 */
function collapse(el, yes) {
    el.classList.toggle('ext-collapsed', !!yes);
    syncCollapseButton(el);
}

/**
 * Applies collapse/expand state to every discovered message.
 */
function toggleAll(container, yes) {
    const msgs = enumerateMessages(container);
    for (const m of msgs) collapse(m, !!yes);
}

/**
 * Applies collapse state only to messages with matching star state.
 */
async function toggleByStar(container, threadKey, starred, collapseState) {
    const msgs = enumerateMessages(container);
    if (!msgs.length) return;
    const entries = msgs.map(el => ({ el, key: `${threadKey}:${keyForMessage(el)}` }));
    const store = await getStore(entries.map(e => e.key));
    for (const { el, key } of entries) {
        const cur = store[key] || {};
        const isStarred = !!cur.starred;
        if (isStarred === starred) collapse(el, collapseState);
    }
}

// ---------------------- Orchestration --------------------------
/**
 * Entry point: finds the thread, injects UI, and watches for updates.
 */
async function bootstrap() {
    // Wait a moment for the app shell to mount
    await sleep(600);
    teardownUI();
    const container = findTranscriptRoot();
    if (!container) return;

    const threadKey = getThreadKey();
    ensurePageControls(container, threadKey);

    function refresh() {
        const msgs = enumerateMessages(container);
        for (const m of msgs) {
            injectToolbar(m, threadKey);
            renderBadges(m, threadKey);
        }
    }

    // Initial pass and observe for changes
    refresh();
    const mo = new MutationObserver(() => {
        // Debounced refresh to handle bursts during streaming
        if (bootstrap._raf) cancelAnimationFrame(bootstrap._raf);
        bootstrap._raf = requestAnimationFrame(refresh);
    });
    mo.observe(container, { childList: true, subtree: true });
    bootstrap._observer = mo;
}

// Some pages use SPA routing; re-bootstrap on URL changes
let lastHref = location.href;
new MutationObserver(() => {
    if (location.href !== lastHref) {
        lastHref = location.href;
        bootstrap();
    }
}).observe(document, { subtree: true, childList: true });

// Surface a minimal pairing API for scripts / devtools.
window.__tagalyst = Object.assign(window.__tagalyst || {}, {
    getThreadPairs: () => {
        const root = findTranscriptRoot();
        return root ? getPairs(root) : [];
    },
    getThreadPair: (idx) => {
        const root = findTranscriptRoot();
        return root ? getPair(root, idx) : null;
    },
});

// First boot
bootstrap();
