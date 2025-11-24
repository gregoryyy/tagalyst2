# Issue #28 Notes

# Tasks
Original issue description (for reference; see implementation plan for actionable steps).

Casual Sunday project: Diverse changes expected to be simple, before the biggies #4 and #6 

Enhancements:
- Thread search highlights text, basis for #6 
- Overview ruler: improve layout of markers 
- Option for nav toolbar

Fixes:
- Option settings only take effect after reload --> shall immediately
- Broken visibility; RCA: likely loading sequence
   - Some toolbars not reliably shown
   - Some sidebar and project list markers not reliably shown
- Buttons sometimes not responsive (eg, star on message toolbars), scrolling changes this
- Check for render errors/reflow violations (poss. due to interaction with host DOM)

Codebase:
- Check better import scheme, like modules (may be issue with Chrome)
- Test coverage: unit and scale tests
- Improve bootstrap sequence

# Codebase Analysis
Architecture and flow are documented in `doc/ARCH.md`; this section focuses on quality risks and remedies.

## Design Flaws and Suggested Improvements
- Globals/imports are fragile (scattered triple-slash, ad hoc runtime attachments, implicit order) → consolidate globals into a single header/attachment point and plan a MV3-safe import/module strategy.
- Script-only composition limits clarity/reuse → keep current script style stable, but define a future ESM/bundling path if dependency weight grows.
- Storage/search limits (`chrome.storage.local` only; no transcript cache; per-page substring search) → add IndexedDB-backed `SearchIndexService`, formalize `ThreadHarvestAdapter`, and support incremental reindex with hashes.
- Reactivity gaps (options need reloads; load timing breaks toolbars/markers/buttons) → make config updates live, harden bootstrap/observer timing, and add UI toggles (e.g., nav toolbar) with immediate effect.
- Testing gaps (render/focus/search/boot timing/import regressions) → expand Jest coverage, add compile/lint guards for globals/imports, and integration tests for search/focus flows.
- DOM abstraction gaps: controllers still reach into ChatGPT DOM structure and `ChatGptThreadAdapter`/`ThreadDom` bake site-specific selectors; introduce a firmer adapter boundary (harvest + render adapters) to insulate from layout changes.
- Transcript model missing: `MessageAdapter.getText()` is DOM-only and ad hoc; define a canonical transcript model/service so UI and indexing can share a normalized document regardless of DOM/API source.
- Mutation/teardown coupling: `BootstrapOrchestrator` mixes observers and UI injection; separate DOM watching from feature renderers to avoid stale UI on SPA changes.
- Adapter testability: no fakes/tests for `ThreadAdapter`/`MessageAdapter`; add fixtures/harnesses to catch DOM heuristic regressions.
- Controller/service boundaries: controllers sometimes own state (e.g., toolbar wiring, focus sync) that could live in services; push stateful logic into services with clear contracts and keep controllers thin for rendering/wiring.
- Render scheduling: `RenderScheduler` exists but usage is ad hoc; define a consistent render loop contract so services request refreshes via a single path, reducing race conditions.

# Issue #28 Implementation Plan

## Codebase (Issue #29)
1. Consolidate globals: centralize shared config/storage/constants/utils/types and runtime attachments (e.g., `TAGALYST_*`, `tagalystStorage`, `EXT_ATTR`, `Utils`, ambient interfaces, `ThreadMetadataService`/`deriveThreadId`) into a single header/attachment point.
   - Shared header added: `src/shared/globals.ts` for config/storage.
   - Content header added: `src/content/globals.ts` for EXT_ATTR/Utils/thread metadata/helpers/controllers.
   - Updated load order (`manifest.json`, `options/options.html`) to include consolidated globals and retained `globalThis` attachments for test exports.
   - Follow-ups: tests still expect per-file attachments; consider moving remaining exports into the headers and dropping per-file globals once test loaders are updated. The current TS/ambient script setup is clunky; these hacks stay until a cleaner module strategy lands.
2. Define a MV3-safe import/module strategy (paper plan + small spike only) without adopting a bundler yet; keep current script-style stable while scoping a future migration.
   - Plan: keep source as ESM with explicit imports/exports, bundle content script to a single classic/IIFE for manifest load; switch service worker/options to module scripts if viable.
   - Steps: introduce esbuild/rollup config targeting content (IIFE, externalize chrome), options (ESM), and shared types; adjust manifest to point to bundled outputs; update tests to import from module entry points instead of globals.
   - Spike: prototype bundling `src/content.ts` → `content/content.js` and `src/options.ts` → `options/options.js`, validate in Chrome dev load, ensure globals/globals.ts either go away or become module exports.
3. Expand Jest coverage for render/focus/search flows to catch regressions.
   - Add specs for search highlighting path (FocusService/FocusController + top-panel interactions).
   - Cover thread metadata controller edge cases (late mounts, project labels) and bootstrap timing.
   - Add adapter/DOM heuristic tests with fixtures to catch layout changes.
4. Add real DOM fixtures: capture sanitized ChatGPT thread HTML via a scripted fetch (e.g., Puppeteer `page.content()` saved to fixtures after removing personal data) so adapters/controllers can be tested against real layouts.
   - Download / capture scripts to create local mirror of the ChatGPT interface in `scripts/mirror`.
   - Thread fixture captured; adapter test `test/content/dom-adapter.test.ts` (with `dom-adapter.conf.json`) loads it to validate ChatGPT adapter/ThreadDom/message adapters.
5. Push state into services and standardize render scheduling: thin controllers to rendering/wiring only, move stateful logic into services with clear contracts, and route refreshes through a single render loop to avoid races.
   - Added `ThreadRenderService` to own the render loop via `RenderScheduler`; bootstrap delegates refresh triggers and teardown to it.
   - Done: focus/tag/search/key/highlight events now request renders via `ThreadRenderService`; toolbar injection/updates and overview refresh all run through the service path.
   - Done: SPA/nav URL changes now reuse the active adapter and reattach the render service on thread/project-thread pages, avoiding full teardown; non-thread routes still re-bootstrap.
   - Added guardrails/telemetry for long renders/re-entrancy in `RenderScheduler` plus a slow-render test.
   - Done: render service uses generation tokens to drop stale/in-flight renders on teardown/navigation.
6. Define a canonical transcript model/service shared by UI and future indexing so DOM/API harvesters can swap without touching controllers.
   - Implemented `TranscriptService` to normalize messages/pairs and feed `ThreadRenderService`.
   - Added fixture test (`test/content/transcript-service.test.ts`) using Thread3 capture.
   - Structure: `TranscriptMessage { id, role, text, adapter }`, `TranscriptPair { index, query, response }`, snapshot includes `pairIndexByMessage`.
   - Future: add API-backed adapter shim so controllers/indexing can swap sources without DOM coupling.
7. Strengthen adapter boundaries: separate harvest adapters from renderers and keep ChatGPT-specific selectors isolated to reduce breakage from DOM changes.
   - Implemented `ThreadAdapterRegistry` to select adapters per host; ChatGPT DOM adapter registered and isolated.
   - Added API-backed adapter shim (`ApiThreadAdapter`) and registry/export wiring; render loop consumes adapters via registry + `TranscriptService`.
   - Tests: registry selection, transcript fixture, and DOM vs API parity using Thread3 capture.
8. Decouple DOM watching from feature renderers: split mutation/teardown concerns so SPA nav doesn’t leave stale UI.
9. Add adapter harnesses/tests: fakes + fixtures for `ThreadAdapter`/`MessageAdapter` to catch heuristic regressions.
10. Plan storage/indexing: design IndexedDB-backed storage + hash-based incremental reindex to overcome `chrome.storage.local` limits for cross-thread search.

## Enhancements (Issue #30)
1. Add per-thread search highlights to search mode as the foundation for cross-thread UX.
2. Refine overview ruler marker layout for clearer alignment and readability.
3. Add an options toggle for the navigation toolbar and wire live show/hide behavior.

## Fixes and Hardening (Issue #31)
1. Stabilize bootstrap/render: audit `BootstrapOrchestrator` timing, ensure controllers mount after config load, and add logging/guards to catch render errors.
2. Make options reactive: propagate `ConfigService` updates immediately without requiring reloads.
3. Fix toolbar visibility load order so message/global toolbars render reliably.
4. Fix sidebar/project marker visibility by adjusting observer timing and retry strategy.
5. Fix unresponsive message toolbar buttons by hardening event wiring and DOM ownership checks.
