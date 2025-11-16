# Tagalyst 2 Architecture

This document tracks the ongoing refactor from a large procedural content script into composable services that isolate ChatGPT-specific DOM details and keep extension behavior stable as the site evolves.

## Current Shape

```
BootstrapOrchestrator
 ├─ RenderScheduler (debounced refresh loop)
 ├─ ThreadDom + ChatGptThreadAdapter (discovery + fallback heuristics)
 ├─ StorageService / ConfigService (chrome.storage glue)
 ├─ MessageMetaRegistry (per-message cache shared by services)
 ├─ FocusService + FocusController (state machine + UI syncing)
 ├─ TopPanelController (Search/Tags panels)
 ├─ ToolbarController (per-message + global controls)
 ├─ ThreadActions / ExportController (batch ops & Markdown)
 ├─ EditorController (tag + note editors)
 ├─ HighlightController (CSS Highlight API orchestration)
 └─ OverviewRulerController (conversation minimap + viewport sync)
```

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

## Next Steps

1. **Modularize Services**  
   - Move each service/controller into its own file (e.g., `src/services/focus.ts`, `src/controllers/toolbar.ts`) so `content.ts` mainly orchestrates dependency wiring. The new class boundaries make this a mechanical split.

2. **Config & Options Integration**  
   - Have the Options page talk directly to `ConfigService` (or a shared facade) so UI toggles stay in sync across popup/options/content surfaces with zero duplicate logic.

3. **Pluggable DOM Adapters**  
   - After splitting modules, experiment with alternate `ThreadAdapter` implementations (e.g., for future ChatGPT layouts or other chat platforms) without touching higher-level controllers. `ThreadDom` already hides the fallback heuristics; the next step is swapping adapter instances via dependency injection.

 These steps continue the same philosophy as earlier refactors: isolate ChatGPT-specific details, ensure behavior stays 1:1, and make every feature depend on adapters + services instead of raw DOM.
