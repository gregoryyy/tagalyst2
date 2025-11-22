# Tagalyst 2: ChatGPT DOM Tools (MV3)

A Chrome extension that adds non-destructive UI on chat.openai.com / chatgpt.com to:
- Collapse/expand any multi-line message with a right-aligned toolbar (each message shows its toolbar + sequential number)
- Tag and bookmark messages locally with inline editors; annotations and tags are managed via floating dialogs
- Use the top-right Search + Tags panels (live filters) together with the bottom-right navigation stack to move through a thread
- View tag frequencies, click any tag to focus matching messages, or type in the search box to filter responses before copying a Markdown snapshot (all or focus-only) via the MD Copy panel
- Highlight any text range inside a prompt/response (with optional annotations), then revisit or remove those highlights later
- Glance at the **overview ruler** that mirrors the thread from top to bottom so you can drag to scroll, click to jump, or inspect markers for message numbers, stars, tags, search hits, and highlights

The guiding visual principle is polarity: ChatGPT keeps its affordances on the left, while Tagalyst draws its controls from the right (top-right panels, right-aligned per-message toolbars, bottom-right navigation). This keeps ownership clear at a glance.

## UI layout
- **Top-right**: Search (type to match any prompt/response text) and Tags (click to toggle one or more tags) panels; these feed the focus controls described below. Feature toggles now live in the Chrome extension **Options** page.
- **Left gutter**: the **Overview Ruler** (collapses to a slim line, expands on hover). Every message shows a horizontal hash with its number; focus markers (stars/tags/search hits) align in their own columns and the thumb mirrors the viewport. Click or drag anywhere on the ruler to scroll the actual thread. Toggle the ruler or its hover-expansion in the Options page.
- **Bottom-right**: the navigation stack (Navigate / Collapse / Expand / Export) used to move around threads, batch actions, and trigger Markdown export.
- **Per message**: a right-aligned toolbar (tags, annotations, star, collapse) plus a left-aligned pair number (`1.` `2.` …) so each exchange can be referenced quickly.

## Focus modes & toolbar icons
Tagalyst keeps one “focus” set at a time, which drives navigation, collapse/expand, and the MD Copy panel:

- **Stars (`☆`/`★`)** – default. Click the toolbar button on any message to bookmark it; navigation arrows (`★↑/★↓`), Collapse `☆`, Expand `★`, and the `★` MD Copy button operate on the starred subset.
- **Tags (`○`/`●`)** – click any tag in the top-right list (multi-select is supported). The toolbar glyph switches to circles and fills whenever a message carries **any** of the selected tags. The per-message focus button is read-only in this mode because membership is derived from tags; navigation/export/collapse now operate on the highlighted tag matches. Disable tag filtering via the extension Options page if you want to hide the panel entirely.
- **Search (`□`/`■`)** – typing in the Search panel swaps the glyph to squares and highlights every prompt/response that contains the query (case-insensitive substring). Controls again operate on the live search results, and clearing the search field returns to tags (if any) or stars.
- **Extension Options** – open `chrome://extensions`, click **Tagalyst 2 → Details → Extension options**, and use the **Enable** column in the Features table to turn the Search, Tag, and Overview surfaces on/off (each surface also has an “Expands” toggle that controls its hover widening behavior). Disabling a pane hides it and clears its state. The same page also shows current storage usage plus Import/Export controls and a “Delete” button if you need a full reset.

The UI always reflects the active mode: the same glyph appears on the navigation buttons, Collapse/Expand focus controls, and the focus-only MD Copy action so it is clear which subset will move/export. Clear the search field and/or deselect tags to fall back to the base starred workflow.

Note: Tagalyst 1 was not robust in the insane ChatGPT frontend structure. This version makes only light-weight assumptions and keeps all overlays out-of-tree so highlights, toolbars, and markers survive DOM churn.

## Text highlights & annotations
- Select any text inside a single prompt or response to reveal the inline **Highlight / Annotate** palette. Highlights are stored per-message (alongside tags/notes) and rehydrated via the CSS Highlight API the next time the thread loads.
- Clicking **Highlight** paints the selection with a soft yellow swatch; picking **Annotate** (available on existing highlights) lets you attach a short note that appears on hover.
- Hovering over a highlight shows its annotation bubble; re-selecting an existing highlight switches the palette into “Remove highlight” mode so you can clear it or edit the note.
- Highlights participate in the overview ruler: annotated snippets occupy the same track as their message lines so you can spot densely marked sections while scrolling.

## Install (Developer Mode)
1. Clone or copy this folder.
2. Ensure the following files exist:
- manifest.json
- content/content.js (built)
- content/content.css
- icons/icon16.png, icon32.png, icon48.png, icon128.png (placeholders OK)
3. Open `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the folder.

## Development
- Install deps: `npm install` (brings in TypeScript + Chrome types only).
- Source of truth lives in `src/content.ts` and `src/options.ts`. The emitted `.js` siblings (`content/content.js`, `options/options.js`) are what MV3 actually loads, so remember to rebuild after edits.
- Build once: `npm run build` (runs `tsc -b` to compile both the content + options projects and rewrite the JS artifacts in-place).
- Live edit loop: `npm run watch` to keep `tsc -b` running, then hit “Reload” on the Chrome extensions page when files update.
- Ambient Chrome + window globals are declared in `src/types/globals.d.ts`. Update that file if you add new surface APIs so `tsc` stays happy.
- No bundler: everything compiles 1:1, so keep imports relative to the file tree Chrome already expects.

### Internals at a glance
- The content script is now composed of services/controllers instead of free functions. Key players:
  - `RenderScheduler` (debounces refresh passes), `ThreadDom` (shared DOM heuristics), and `ChatGptThreadAdapter` (MutationObserver + adapter factory).
  - `StorageService` / `ConfigService` (chrome.storage glue), `MessageMetaRegistry` (per-message cache), and the `FocusService` + `FocusController` pair (state machine + UI syncing).
  - `TopPanelController` (Search/Tags panels), `ToolbarController` (per-message + global controls), `ThreadActions` (collapse/expand), `ExportController` (Markdown copy), and `EditorController` (tag/note editors).
- `ARCH.md` tracks the ongoing refactor and the next structural steps; skim it when touching internals so new code follows the same dependency flow.

## Notes
- Data is stored locally via `chrome.storage.local` keyed by `{threadKey}:{messageKey}`.
- Whenever ChatGPT exposes `data-message-id` on a message, that UUID becomes the `{messageKey}` input so the backend (or other tools) can correlate records 1:1. If the attribute is missing we fall back to a hash of the message text + position.
- Message blocks are discovered via the stable `data-message-author-role` attribute (user / assistant) that ChatGPT renders on every turn. If that attribute disappears, the content script falls back to the old heuristics in `isMessageNode`.
- The script is defensive (MutationObserver + heuristics). DOM changes on the site can still break selectors; update `isMessageNode` heuristics if needed.
- This extension never calls private ChatGPT APIs and avoids reparenting nodes, minimizing breakage.
- When switching chats the extension tears down and rebuilds its UI automatically, so you can move between projects without stale controls.
- Tests: Jest covers utilities/controllers and a load smoke; run via `npm test`. Optional E2E smoke is `npm run test:e2e` (skips unless Puppeteer/Chrome available—use `puppeteer-core` + `PUPPETEER_EXECUTABLE_PATH` or install full Puppeteer).
- Page scope: UI injects only on conversation pages (`/c/...`), including project threads; project overview pages skip UI and trigger teardown. Overview ruler filters still apply on valid threads.
- Keyboard: YAML-driven shortcuts (`content/keymap.yaml`) control navigation/collapse/export/search/star; defaults ship in the YAML and fall back to baked-in mappings if the file is unreachable.

## Development
- Install dependencies: `npm install`
- Run the Jest suite (non-visual helpers): `npm test`
- Build a distributable ZIP (`dist/tagalyst2.zip`): `npm run build`

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
See `TODO.md`
