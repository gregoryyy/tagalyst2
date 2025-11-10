// ---------------------- Orchestration --------------------------
/**
 * Entry point: finds the thread, injects UI, and watches for updates.
 */
async function bootstrap() {
    // Wait a moment for the app shell to mount
    await sleep(600);
    await ensureConfigLoaded();
    teardownUI();
    const container = findTranscriptRoot();
    if (!container) return;

    const threadKey = getThreadKey();
    ensurePageControls(container, threadKey);
    ensureTopPanels();

    let refreshRunning = false;
    let refreshQueued = false;

    async function refresh() {
        if (refreshRunning) {
            refreshQueued = true;
            return;
        }
        refreshRunning = true;
        try {
            do {
                refreshQueued = false;
                const msgs = enumerateMessages(container);
                const pairMap = new Map();
                const pairs = getPairs(container);
                pairs.forEach((pair, idx) => {
                    if (pair.query) pairMap.set(pair.query, idx);
                    if (pair.response) pairMap.set(pair.response, idx);
                });
                const entries = msgs.map(el => ({
                    el,
                    key: `${threadKey}:${keyForMessage(el)}`,
                    pairIndex: pairMap.get(el)
                }));
                if (!entries.length) break;
                const keys = entries.map(e => e.key);
                const store = await getStore(keys);
                const tagCounts = new Map();
                messageState.clear();
                for (const { el, key, pairIndex } of entries) {
                    injectToolbar(el, threadKey);
                    ensurePairNumber(el, pairIndex);
                    const value = store[key] || {};
                    setMessageMeta(el, { key, value, pairIndex });
                    if (value && Array.isArray(value.tags)) {
                        for (const t of value.tags) {
                            if (!t) continue;
                            tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
                        }
                    }
                    renderBadges(el, threadKey, value);
                }
                const sortedTags = Array.from(tagCounts.entries())
                    .map(([tag, count]) => ({ tag, count }))
                    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
                updateTagList(sortedTags);
                refreshFocusButtons();
            } while (refreshQueued);
        } finally {
            refreshRunning = false;
        }
    }

    const requestRefresh = () => {
        if (bootstrap._raf) cancelAnimationFrame(bootstrap._raf);
        bootstrap._raf = requestAnimationFrame(refresh);
    };
    bootstrap._requestRefresh = requestRefresh;

    // Initial pass and observe for changes
    refresh();
    const mo = new MutationObserver((records) => {
        if (!records.some(mutationTouchesExternal)) return;
        requestRefresh();
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
function ensureTopPanels() {
    if (topPanelsEl) return topPanelsEl;
    const wrap = document.createElement('div');
    wrap.id = 'ext-top-panels';
    wrap.innerHTML = `
        <div class="ext-top-frame ext-top-search">
            <span class="ext-top-label">Search</span>
            <input type="text" class="ext-search-input" placeholder="Search messages…" />
        </div>
        <div class="ext-top-frame ext-top-tags">
            <span class="ext-top-label">Tags</span>
            <div class="ext-tag-list" id="ext-tag-list"></div>
        </div>
    `;
    markExtNode(wrap);
    document.body.appendChild(wrap);
    topPanelsEl = wrap;
    tagListEl = wrap.querySelector('#ext-tag-list');
    searchInputEl = wrap.querySelector('.ext-search-input');
    if (searchInputEl) {
        searchInputEl.value = focusState.searchQuery;
        searchInputEl.addEventListener('input', (evt) => handleSearchInput(evt.target.value));
    }
    updateConfigUI();
    syncTopPanelWidth();
    return wrap;
}

function updateTagList(counts) {
    ensureTopPanels();
    if (!tagListEl) return;
    tagListEl.innerHTML = '';
    tagListEl.classList.toggle('ext-tags-disabled', !areTagsEnabled());
    if (!counts.length) {
        const empty = document.createElement('div');
        empty.className = 'ext-tag-sidebar-empty';
        empty.textContent = 'No tags yet';
        tagListEl.appendChild(empty);
        return;
    }
    for (const { tag, count } of counts) {
        const row = document.createElement('div');
        row.className = 'ext-tag-sidebar-row';
        row.dataset.tag = tag;
        const label = document.createElement('span');
        label.className = 'ext-tag-sidebar-tag';
        label.textContent = tag;
        const badge = document.createElement('span');
        badge.className = 'ext-tag-sidebar-count';
        badge.textContent = count;
        row.append(label, badge);
        row.classList.toggle('ext-tag-selected', focusState.selectedTags.has(tag));
        row.addEventListener('click', () => toggleTagSelection(tag));
        tagListEl.appendChild(row);
    }
    syncTagSidebarSelectionUI();
}

function runExport(container, focusOnly) {
    try {
        const md = exportThreadToMarkdown(container, focusOnly);
        navigator.clipboard.writeText(md).catch(err => console.error('Export failed', err));
    } catch (err) {
        console.error('Export failed', err);
    }
}

function exportThreadToMarkdown(container, focusOnly) {
    const pairs = getPairs(container);
    const sections = [];
    pairs.forEach((pair, idx) => {
        const num = idx + 1;
        const isFocused = focusOnly ? isPairFocused(pair) : true;
        if (focusOnly && !isFocused) return;
        const query = pair.query ? pair.query.innerText.trim() : '';
        const response = pair.response ? pair.response.innerText.trim() : '';
        const lines = [];
        if (query) {
            lines.push(`### ${num}. Prompt`, '', query);
        }
        if (response) {
            if (lines.length) lines.push('');
            lines.push(`### ${num}. Response`, '', response);
        }
        if (lines.length) sections.push(lines.join('\n'));
    });
    return sections.join('\n\n');
}

function isPairFocused(pair) {
    const nodes = [];
    if (pair.query) nodes.push(pair.query);
    if (pair.response) nodes.push(pair.response);
    return nodes.some(node => {
        const meta = messageState.get(node);
        return isMessageFocused(node, meta?.value || {});
    });
}

function syncTopPanelWidth() {
    if (!topPanelsEl) return;
    const controls = document.getElementById('ext-page-controls');
    const refWidth = controls ? controls.getBoundingClientRect().width : null;
    const width = refWidth && refWidth > 0 ? refWidth : topPanelsEl.getBoundingClientRect().width || 200;
    topPanelsEl.style.width = `${Math.max(100, Math.round(width))}px`;
}

if (chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;
        const change = changes[CONFIG_STORAGE_KEY];
        if (!change) return;
        applyConfigObject(change.newValue);
    });
}
