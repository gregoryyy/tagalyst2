# Issue #28: Codebase Analysis (Tagalyst 2)

## High-Level Shape
- MV3 Chrome extension, TypeScript without bundling; sources in `src/`, emitted JS/CSS live 1:1 under `content/` and `options/` via `npm run build` (tsc -b).
- Script-style globals for config/storage/types (`src/shared/config.ts`, `src/shared/storage.ts`, `src/types/globals.d.ts`), referenced via triple-slash directives instead of ES modules.
- `content.ts` orchestrates services/controllers; `options.ts` handles the options page; tests via Jest + chrome mocks in `test/`.

## Content Script Architecture (per ARCH.md)
- Discovery/DOM: `ThreadDom` + `ChatGptThreadAdapter` for message/pair enumeration and MutationObserver wiring; adapters expose `MessageAdapter`/`PairAdapter` interfaces.
- State/Storage: `StorageService` wraps `chrome.storage.local`; `MessageMetaRegistry` caches per-element metadata; `ThreadMetadataService` handles thread-level info (title/tags/note/size/length/chars/starred).
- Config: `ConfigService` loads/persists `TAGALYST_DEFAULT_CONFIG` (search/tags/overview/meta/sidebar labels toggles) and schedules renders via `RenderScheduler`.
- Focus: `FocusService`/`FocusController` track stars/tags/search modes (search is simple substring over normalized DOM text); drives toolbar glyphs, nav, overview markers.
- UI controllers: top panel (search/tags), per-message + bottom toolbar (`ToolbarController` + `ThreadActions`), highlight palette (`HighlightController`), overview ruler, thread header metadata bar, sidebar/project list labels, keyboard bindings, export controller.

## Storage & Data Model
- Per-message records keyed by `{threadKey}:{messageKey}` (message keys from DOM IDs/hashes) stored in `chrome.storage.local`; values include tags/notes/stars/highlights.
- Thread-level metadata keyed by `__tagalyst_thread__{threadId}` via `ThreadMetadataService`; holds name, tags, note, size/length/chars, starred.
- No IndexedDB usage today; no cached transcript bodies beyond per-message text pulled from DOM at runtime (`MessageAdapter.getText()` strips extension nodes and normalizes text).

## Search Status (Gap for Issue #6)
- Current search is in-page only: focus mode `SEARCH` toggled by top-panel input; matches via substring against live DOM text; no cross-thread index or persistence.
- Tag frequencies/picks and overview markers derive from in-memory `MessageMetaRegistry`; nothing spans multiple threads.

## Hooks Useful for Cross-Thread Indexing
- Harvest inputs: `ThreadDom`/`ChatGptThreadAdapter` to enumerate messages/pairs; `MessageAdapter.getText()` for normalized message text; `ThreadMetadataService` already tracks thread-level stats/tags/stars.
- Nav surfaces: sidebar/project label controllers show how stored thread metadata decorates nav lists—can be extended to display search hits/counts.
- Config/Options: toggles exist; a new search/index feature can add flags to `TAGALYST_DEFAULT_CONFIG` and options UI.

## Constraints / Notes
- Keep DOM overlays non-destructive (EXT_ATTR markers) per current design.
- IndexedDB would be new surface (permissionless in-page); storage quotas of `chrome.storage.local` likely insufficient for transcript corpora.
- Network interception is not present; current approach is DOM-first and should degrade gracefully with SPA nav changes handled by `BootstrapOrchestrator`.

## Suggested Improvements
- Storage/index layer: introduce an IndexedDB-backed `SearchIndexService` with schema for thread docs and prebuilt lunr/elasticlunr shards; keep a thin adapter over `chrome.storage.local` for metadata coherence.
- Harvest adapters: formalize `ThreadHarvestAdapter` interface (DOM first, API-capable later) to produce normalized documents (thread id/project id/title, messages text, annotations/tags/stars/highlights, size/chars).
- Incremental sync: add hash-based staleness checks per thread (e.g., doc hash over messages + metadata) to skip reindexing unchanged threads; hook SPA nav changes in `BootstrapOrchestrator`.
- UI entry points: add a search button to thread/project/nav surfaces that opens a result list overlay and optionally filters sidebar lists; expose a “Reindex all” in options with progress feedback.
- Config/test hardening: extend `TAGALYST_DEFAULT_CONFIG` and options page for search/index toggles; add unit tests for new services (IndexedDB wrapper, harvest normalization) and integration tests for focus/search flows.

## Issue #28 Task List (UI enhancements and fixes)
- [ ] Thread search highlights text (foundation for #6).
- [ ] Improve overview ruler marker layout.
- [ ] Add option to show/hide navigation toolbar.
- [ ] Make option changes apply immediately (no reload requirement).
- [ ] Fix intermittent visibility of toolbars and sidebar/project markers (likely load sequence).
- [ ] Fix unresponsive buttons (e.g., star on message toolbars) without needing scroll.
- [ ] Audit for render errors/reflow violations (extension DOM vs host DOM).
- [ ] Explore better import/module scheme (MV3-compatible).
- [ ] Increase test coverage (unit + scale).
- [ ] Harden bootstrap sequence.

## Issue #28 Implementation Plan (numbered)
1. Stabilize bootstrap/render: audit `BootstrapOrchestrator` timing, ensure controllers mount after config load, and add logging/guards to catch render errors.
2. Options reactivity: wire `ConfigService` updates to re-render immediately; verify nav toolbar toggle and other feature flags live-update without reload.
3. UI polish: refine overview ruler marker layout and ensure nav toolbar can be toggled; harden message toolbar event wiring to prevent unresponsive buttons.
4. Visibility/load fixes: adjust load sequence for toolbars and sidebar/project markers (mutation observer timing, retries) and add sanity checks for DOM ownership.
5. Search highlight (per-thread): augment search mode to apply inline text highlights as the basis for cross-thread search UX.
6. Testing and imports: expand Jest coverage (render flows, focus/search) and prototype a safer import/module scheme compatible with MV3 script style.
