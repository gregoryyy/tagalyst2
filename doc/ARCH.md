# Tagalyst 2 Architecture

This document tracks the ongoing refactor from a large procedural content script into composable services that isolate ChatGPT-specific DOM details and keep extension behavior stable as the site evolves.

## Current Shape

```
BootstrapOrchestrator
 ├─ RenderScheduler (debounced refresh loop)
 ├─ ThreadDom + ChatGptThreadAdapter (discovery + fallback heuristics)
 ├─ StorageService / ConfigService (chrome.storage glue)
 ├─ ThreadMetadataService + ThreadMetadataController (thread header toolbar)
 ├─ MessageMetaRegistry (per-message cache shared by services)
 ├─ FocusService + FocusController (state machine + UI syncing)
 ├─ TopPanelController (Search/Tags panels)
 ├─ ToolbarController (per-message + global controls)
 ├─ ThreadActions / ExportController (batch ops & Markdown)
 ├─ EditorController (tag + note editors)
 ├─ HighlightController (CSS Highlight API orchestration)
 ├─ OverviewRulerController (conversation minimap + viewport sync)
 ├─ SidebarLabelController (labels in chat sidebar)
 └─ ProjectListLabelController (labels in project lists)
```

## Build & Globals
- TypeScript, no bundler; `npm run build` runs `tsc -b` to emit 1:1 JS/CSS into `content/` and `options/`.
- Globals come from script files (`src/shared/config.ts`, `src/shared/storage.ts`, `src/types/globals.d.ts`) and triple-slash references rather than ES modules; content code is classic script style.
- Ambient constants include `TAGALYST_DEFAULT_CONFIG`/`TAGALYST_CONFIG_STORAGE_KEY`, `tagalystStorage`, `EXT_ATTR`, and the `Utils` namespace. Runtime helpers such as `ThreadMetadataService` and `deriveThreadId` are attached to `globalThis`.

### ThreadDom, Adapters, and Scheduler
- `ChatGptThreadAdapter` still owns MutationObserver wiring and produces `MessageAdapter` / `PairAdapter` instances, but `ThreadDom` now provides the shared fallback heuristics (enumerating messages, building pairs, finding navigation nodes). Controllers never touch `default*` helpers directly anymore.
- `RenderScheduler` replaces the ad-hoc `requestRefresh` globals. It stores the active async render callback and coalesces `requestAnimationFrame` ticks so config changes, MutationObserver events, and focus toggles all reuse the same queueing mechanism.

### StorageService + ConfigService
- Storage access continues to flow through `StorageService.read`/`write` and the `readMessage` / `writeMessage` helpers so every caller uses adapter-derived keys.
- `ConfigService` now receives the scheduler instance. Whenever it applies an update it (a) enforces feature invariants (clearing search/tags when disabled), (b) notifies listeners, (c) asks `FocusController` to re-evaluate modes, and (d) schedules a render. There are no remaining free functions such as `isSearchEnabled`; everything goes through this service.

### MessageMetaRegistry
- Replaces the old `messageState` Map with a typed registry that can `ensure`, `update`, `resolveAdapter`, and garbage-collect metadata per DOM element. Controllers/services no longer need to remember how metadata is stored; they call registry helpers instead.

### FocusService + FocusController
- `FocusService` still models search/tag/star modes, but the new `FocusController` handles UI concerns: caching page controls, refreshing toolbar glyphs, syncing tag sidebar selections, and answering “is this pair focused?” It centralizes all focus-related DOM updates so other modules only invoke `focusController.*` methods.

### TopPanelController
- Manages the Search/Tags panels and now exposes `syncWidth()` so its layout can track the global toolbar width without a global helper. It reads feature toggles via `ConfigService` and feeds focus changes back through `FocusController`.

### ToolbarController
- Owns both the bottom navigation stack and the per-message toolbar injection. It now handles badge rendering, pair number chips, collapse button wiring, and the documented-but-disabled user button skeleton. `ThreadActions` supplies the actual collapse logic, but the controller determines when to call it.
- Emits hover menus for text-selection actions by delegating to `HighlightController` (see below) so highlight UX hooks live next to the per-message toolbar.

### EditorController
- Still encapsulates note/tag editor lifecycles. The bootstrapper’s teardown path simply calls `editorController.teardown()` before removing DOM nodes.

### HighlightController
- Provides text range capture, persistence, and rendering using the CSS Highlight API. It normalizes selections relative to each message, stores highlights/annotations alongside other message metadata, and restores them by creating/deleting named highlights.
- Exposes a selection palette (Highlight / Annotate / Remove) that appears only when the user selects text inside a single message. Hover tooltips reuse stored annotations, and highlight IDs feed into the overview ruler so marked regions show up in the minimap.

### OverviewRulerController
- Renders the left-hand “overview ruler,” a slim scrollbar-like track that mirrors the entire thread. It lays out message number ticks, focus markers (stars/tags/search hits), highlight markers, and a viewport thumb that tracks real scroll position.
- Supports hover expansion plus click/drag interactions that scroll the actual conversation. Marker columns are deterministic: message ticks, focus glyphs, and special markers all share the same coordinate system so navigation feels natural.

### ThreadActions + ExportController
- `ThreadActions` gained helpers to keep collapse button glyphs in sync, so no other code pokes `.ext-collapse` buttons directly.
- `ExportController` became a pure dependency of the toolbar; the obsolete `runExport`/`exportThreadToMarkdown` wrappers were removed.

### BootstrapOrchestrator
- Sets up config, adapters, controllers, and the render loop. During each refresh it:
  1. Resolves message/pair adapters via `threadDom`.
  2. Reads storage in a single batch.
  3. Hydrates the `MessageMetaRegistry`.
  4. Asks `ToolbarController` to inject/update controls.
  5. Updates tag frequency data for the top panel.
  6. Delegates focus button refreshes to `FocusController`.
- Teardown is encapsulated inside the orchestrator so SPA navigations or failures have a single cleanup path.

### Utilities
- Stateless helpers live in the `Utils` namespace (hashing, text normalization, caret placement, floating editor positioning, DOM ownership markers). Anything that needs state moved into one of the services/controllers above.

## Current Shape and Page Classification

The content script is modular; `content.ts` orchestrates services/controllers/adapters. A `PageClassifier` determines page kind:
- `thread` and `project-thread` (URLs containing `/c/`, optionally `/g/`) → UI injects (toolbars, highlights, ruler, keyboard).
- `project` overview (URLs with `/g/.../project`) and other pages → UI skips/tears down.

## Next Steps

1. **Controller Attach/Detach by Page Kind**  
   - Continue to attach only the controllers needed per page type; add new classifiers if future surfaces (e.g., Gemini) are supported.

2. **Config & Options Integration**  
   - Keep Options and content aligned via shared config/storage; add tests for options-controller and config flows.

3. **Pluggable DOM Adapters**  
   - Preserve the ability to swap adapters for alternate layouts/platforms via dependency injection without touching controllers.

4. **Performance & UX**  
   - Smooth overview ruler interactions; keyboard shortcut robustness across SPA changes; highlight rendering under large threads.

## Known Risks / Quality Focus
- Globals/imports are fragile and scattered; plan to centralize ambient attachments and consider a future MV3-safe module strategy without breaking classic content scripts.
- Controllers sometimes carry state and DOM knowledge; push state into services with clear contracts and keep controllers thin.
- Render scheduling is ad hoc despite `RenderScheduler`; enforce a single render loop for refresh requests to avoid races.
- DOM coupling: `ChatGptThreadAdapter`/`ThreadDom` bake selectors; introduce a firmer adapter boundary (harvest + render) and a normalized transcript model so UI and indexing can swap data sources (DOM/API).
- Storage/search limits: only `chrome.storage.local` is used; no transcript cache or index. IndexedDB-backed indexing plus hash-based incremental updates is the intended path.
- Reactivity gaps: config/options should apply immediately; bootstrap/observer timing currently causes missing toolbars/markers and occasional unresponsive buttons.
- Testing gaps: increase coverage for render/focus/search flows, bootstrap timing, and adapter heuristics; add real DOM fixtures (sanitized ChatGPT HTML) to exercise adapters and controllers against real layouts.
