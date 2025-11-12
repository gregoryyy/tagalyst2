# Tagalyst 2 Architecture

This document tracks the ongoing refactor from a large procedural content script into composable services that isolate ChatGPT-specific DOM details and keep extension behavior stable as the site evolves.

## Current Shape

```
BootstrapOrchestrator
 ├─ ThreadAdapter (DOM discovery, MutationObserver)
 ├─ ToolbarController (global + per-message controls)
 ├─ EditorController (tag + note editors)
 ├─ FocusService (search/tags/stars state + navigation)
 ├─ StorageService (chrome.storage wrapper)
 └─ DOM adapters (MessageAdapter / PairAdapter)
```

### Thread Adapter + Adapters
- `ChatGptThreadAdapter` owns DOM discovery and MutationObserver wiring. It builds `MessageAdapter` and `PairAdapter` objects so the rest of the code never couples to ChatGPT’s markup.
- Fallback helpers still exist (e.g., `defaultEnumerateMessages`) but only run when the adapter is unavailable, keeping behavior identical while slimming the DOM surface area.

### Message / Pair Adapters
- `DomMessageAdapter` exposes `key`, `role`, normalized text, collapse heuristics, and `storageKey(threadKey)`.
- `DomPairAdapter` groups messages into (prompt,response) pairs and feeds navigation/export logic.
- `messageState` stores adapters per element so focus/search/tag logic can reuse metadata. Navigation and collapse-by-focus now work with adapter lists, only touching `adapter.element` when scrolling/manipulating DOM.

### FocusService
- Replaces the global focus state: tracks search query, tag selections, focus mode, and navigation index.
- Provides helpers (`setSearchQuery`, `toggleTag`, `getMatches`, `isMessageFocused`, `adjustNav`) so controllers call the service rather than poking Sets/strings directly.

### StorageService
- Wraps `chrome.storage.local` with typed async helpers plus `readMessage` / `writeMessage`. Message-level storage goes through adapters, ensuring keys are consistent everywhere.

### ToolbarController
- Handles both the global bottom-right controls and per-message toolbars.
- Wires navigation scroll, collapse/expand/export buttons, bookmark toggles, and keeps focus glyphs in sync with `FocusService`.

### ConfigService + TopPanelController
- `ConfigService` now wraps all config reads/writes (`chrome.storage.local`) and notifies listeners when settings change. It enforces focus state invariants and schedules refreshes without leaking storage logic into UI layers.
- `TopPanelController` builds and manages the floating Search/Tags panels, wires search input + tag row events to `FocusService`, keeps the UI in sync with config toggles, and exposes helpers for tag list refreshes and layout.

### EditorController
- Manages both tag and note editors: opening, closing, floating positioning, keyboard shortcuts, and storage updates.
- `teardownUI` now just calls `editorController.teardown()` so active editors are cleaned up uniformly.

### ThreadActions + ExportController
- `ThreadActions` encapsulates collapse/expand operations (single message, all messages, focus-only). Controllers call its methods instead of touching DOM helpers directly.
- `ExportController` owns Markdown export and clipboard writes so toolbar buttons simply ask it to copy the current thread/focus subset.

### BootstrapOrchestrator
- Coordinates startup: waits for page stabilization, loads config, instantiates the thread adapter, injects top panels + toolbars, and runs the refresh loop.
- Refresh builds adapter caches, hydrates storage metadata, updates badges/tag counts, and uses `requestRefresh` for MutationObserver + SPA navigation.
- `activeBootstrap` stores the current render callback, allowing config/UI updates to queue a refresh without reimplementing the logic.

### Utilities
- Pure helpers (hashing, text normalization, caret placement, floating editor layout) stay as standalone functions since they have no state or dependencies.

## Next Steps

1. **Modularize Services**  
   - Move each service/controller into its own file (e.g., `src/services/focus.ts`, `src/controllers/toolbar.ts`) so `content.ts` mainly orchestrates dependency wiring.

2. **Config & Options Integration**  
   - Have the Options page talk directly to `ConfigService` via a shared module so UI toggles stay in sync across the popup/options/content surfaces without duplicate logic.

3. **Pluggable DOM Adapters**  
   - Once modules are split, experiment with swapping `ThreadAdapter` implementations (e.g., for future ChatGPT layouts or other chat platforms) without touching higher-level controllers.

These steps continue the same philosophy as earlier refactors: isolate ChatGPT-specific details, ensure behavior stays 1:1, and make every feature depend on adapters + services instead of raw DOM.
