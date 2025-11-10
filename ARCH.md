# Tagalyst 2 Architecture

## High-level layout
- `manifest.json` – Chrome MV3 manifest describing permissions, content scripts, and the extension options page.
- `content/` – all code/styles injected into chat.openai.com / chatgpt.com.
  - `util.js` – shared utilities (hashing, storage helpers, config/state management, focus calculations, etc.).
  - `editors.js` – inline editor lifecycle (tag/note modals, floating positioning helpers).
  - `view.js` – higher-level DOM helpers for toolbars, navigation controls, panels, and focus UI.
  - `content.js` – orchestration: bootstraps observers, coordinates refresh cycles, listens for storage changes, exposes the public `window.__tagalyst` helpers.
  - `content.css` – styles for toolbars, overlays, panels, dialogs.
- `options/` – extension Options page (HTML/CSS/JS) where toggle settings live alongside storage import/export/delete actions.
- `README.md`, `TODO.md`, `ARCH.md` – docs/macros of functionality, remaining work, and this architecture overview.

## Runtime flow
1. **Injection:** Chrome loads `util.js`, `editors.js`, `view.js`, and `content.js` (in that order) on matching pages. `util.js` sets up storage helpers, config watchers, and focus-state logic; `editors.js` handles inline editors; `view.js` defines the rest of the DOM manipulation helpers; `content.js` wires everything together (discovering messages, injecting controls, handling refreshes).
2. **Config:** Runtime settings live in `chrome.storage.local` under `__tagalyst_config`. Changes triggered via the Options page fire `chrome.storage.onChanged`, and `content.js` immediately re-applies the configuration without needing a reload.
3. **UI Composition:** `content.js` assembles toolbars, navigation controls, and top-panel search/tag widgets via helpers in `view.js`, delegates tag/note editing to `editors.js`, and reads/writes state via `util.js` helpers (`getStore`, `setStore`, `focusState`, etc.).
4. **Options workflow:** `options/options.html` + `options/options.js` render a plain settings dashboard with feature toggles and storage utilities (view/import/export/delete). All operations use `chrome.storage.local`, so the content script automatically sees changes.

## Storage model
- Per-message data stored under keys `${threadKey}:${messageKey}` (thread derived from URL, message key from ChatGPT ID + fallback hash).
- Config object stored once (`__tagalyst_config`).
- Options page import/export writes the entire storage JSON; delete clears everything.

## Key extension APIs
- `window.__tagalyst.getThreadPairs()` / `getThreadPair(idx)` – quick access during development.
- `window.__tagalyst.getStorageUsage()` / `clearStorage()` – inspect or reset stored data from DevTools.

Use this document when navigating the repo or planning refactors; `TODO.md` captures outstanding behavior/feature work, while `README.md` explains user-visible functionality.
