# Tagalyst 2: ChatGPT DOM Tools (MV3)

A Chrome extension that adds non-destructive UI on chat.openai.com / chatgpt.com to:
- Collapse/expand any multi-line message with a right-aligned toolbar (each message shows its toolbar + sequential number)
- Tag and bookmark messages locally with inline editors; annotations and tags are managed via floating dialogs
- Use the top-right Search + Tags panels (live filters) together with the bottom-right navigation stack to move through a thread
- View tag frequencies, click any tag to focus matching messages, or type in the search box to filter responses before copying a Markdown snapshot (all or focus-only) via the MD Copy panel

The guiding visual principle is polarity: ChatGPT keeps its affordances on the left, while Tagalyst draws its controls from the right (top-right panels, right-aligned per-message toolbars, bottom-right navigation). This keeps ownership clear at a glance.

## UI layout
- **Top-right**: Search (type to match any prompt/response text) and Tags (click to toggle one or more tags) panels; both feed the focus controls described below.
- **Bottom-right**: the navigation stack (Navigate / Collapse / Expand / Export) used to move around threads, batch actions, and trigger Markdown export.
- **Per message**: a right-aligned toolbar (tags, annotations, star, collapse) plus a left-aligned pair number (`1.` `2.` …) so each exchange can be referenced quickly.

## Focus modes & toolbar icons
Tagalyst keeps one “focus” set at a time, which drives navigation, collapse/expand, and the MD Copy panel:

- **Stars (`☆`/`★`)** – default. Click the toolbar button on any message to bookmark it; navigation arrows (`★↑/★↓`), Collapse `☆`, Expand `★`, and the `★` MD Copy button operate on the starred subset.
- **Tags (`○`/`●`)** – click any tag in the top-right list (multi-select is supported). The toolbar glyph switches to circles and fills only when a message carries **all** of the selected tags. The per-message focus button is read-only in this mode because membership is derived from tags; navigation/export/collapse now operate on the highlighted tag matches.
- **Search (`□`/`■`)** – typing in the Search panel swaps the glyph to squares and highlights every prompt/response that contains the query (case-insensitive substring). Controls again operate on the live search results, and clearing the search field returns to tags (if any) or stars.

The UI always reflects the active mode: the same glyph appears on the navigation buttons, Collapse/Expand focus controls, and the focus-only MD Copy action so it is clear which subset will move/export. Clear the search field and/or deselect tags to fall back to the base starred workflow.

Note: Tagalyst 1 was not robust in the insane ChatGPT frontend structure. This version makes only light-weight assumptions and restricts to list item-level operations not actual text highlighting.


## Install (Developer Mode)
1. Clone or copy this folder.
2. Ensure the following files exist:
- manifest.json
- content/content.js
- content/content.css
- icons/icon16.png, icon32.png, icon48.png, icon128.png (placeholders OK)
3. Open `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the folder.


## Notes
- Data is stored locally via `chrome.storage.local` keyed by `{threadKey}:{messageKey}`.
- Whenever ChatGPT exposes `data-message-id` on a message, that UUID becomes the `{messageKey}` input so the backend (or other tools) can correlate records 1:1. If the attribute is missing we fall back to a hash of the message text + position.
- Message blocks are discovered via the stable `data-message-author-role` attribute (user / assistant) that ChatGPT renders on every turn. If that attribute disappears, the content script falls back to the old heuristics in `isMessageNode`.
- The script is defensive (MutationObserver + heuristics). DOM changes on the site can still break selectors; update `isMessageNode` heuristics if needed.
- This extension never calls private ChatGPT APIs and avoids reparenting nodes, minimizing breakage.
- When switching chats the extension tears down and rebuilds its UI automatically, so you can move between projects without stale controls.

## Terminology & Pair API
- **Thread** (`t`) is the ordered list of conversational exchanges. (Use “session” only when referring to time-bounded usage, not the DOM thread.)
- **Pair** (`p = (q, r)`) is a single user query `q` and its assistant response `r`. There are currently no response variants, so `t = [p₀, p₁, …]`.

The content script exposes a tiny helper API for debugging or other extensions:

```js
// Return all pairs in the current thread
window.__tagalyst.getThreadPairs(); // => [{ query, queryId, response, responseId }, ...]

// Return the p-th pair (0-indexed). Useful notation: p_i = getThreadPair(i).
window.__tagalyst.getThreadPair(3);
```

These helpers respect the same discovery logic as the UI (preferring `data-message-author-role` and falling back to heuristics).


## Roadmap
- Cross-chat search including tags and annotations
- Text range markup within responses
- Export visible thread to Markdown (DOM-only)
  - Selection within thread: tags, stars, search results
  - Assemble across threads: export session
- Optional Shadow DOM for toolbar isolation
- ... also see `TODO.md`
