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
   - Implemented `DomWatcher` for mutation + URL watching; render service listens for mutations/nav.
   - Tests: `test/content/dom-watcher.test.ts` covers mutation events and root changes (re-attach) on external nodes.
9. Add adapter harnesses/tests: fakes + fixtures for `ThreadAdapter`/`MessageAdapter` to catch heuristic regressions.
   - Implemented adapter fakes (`FakeThreadAdapter`) and harness tests (fixture parity, edge cases) plus API shim parity.
   - Tests: adapter registry selection, DOM vs API parity, fixture transcript, and fake adapter edge cases.
10. Plan storage/indexing: design IndexedDB-backed storage + hash-based incremental reindex to overcome `chrome.storage.local` limits for cross-thread search.
    - Plan: introduce `IndexedDbStorage` for transcripts/snippets; add hash-based dedupe per message/snippet.
    - Steps: define schema (threads, messages, tags, highlights, index terms), add background indexer, and wire `TranscriptService` outputs into the indexer.
    - Tests: persistence/lookup round trips, reindex skips unchanged messages (hash compare), and capacity/cleanup checks.
    - Proposal: start with a lightweight IndexedDB layer (`idb` wrapper or vanilla) storing `{ threadId, messageId, role, textHash, text, tags, highlights }` plus an inverted index table keyed by term → message ids. Use `TranscriptService` hashes to skip unchanged messages during reindex; keep `chrome.storage` for config/options only. Add a background reindexer triggered on thread render completion and a simple search API that returns message ids + snippets for UI consumption.
    - --> We leave this only as a plan.

## Enhancements (Issue #30)
1. Add per-thread search highlights to search mode as the foundation for cross-thread UX.
   - Plan: extend search mode to apply CSS highlights to matching messages and tags; surface counts in top panel and overview ruler.
   - Steps: reuse FocusService search query to mark matches; integrate with HighlightController for visual marks; ensure render service updates overview markers and toolbar badges; add tests against Thread3 fixture to verify match counts and highlighting.
   - Future: feed these highlights into cross-thread index once storage/indexing (step 10) lands.
2. Refine overview ruler marker layout for clearer alignment and readability: light gray lanes.
   - Plan: add subtle vertical lanes behind star/tag/search markers to improve alignment/readability and adjust spacing/hover clarity.
   - Steps: update overview ruler DOM to include lane backgrounds per marker kind, tweak CSS widths/padding so markers sit within lanes, ensure no overlap with content.
3. Add an options toggle for the navigation toolbar and wire live show/hide behavior.
   - Plan: add a new option in Options UI to enable/disable the nav toolbar; persist in config and reactively show/hide without reload.
   - Steps: update config schema/defaults, options page, and TopPanel/Toolbar controllers to respect the toggle; ensure render service detaches/tears down toolbar when disabled.
   - Tests: options controller round-trip for the new flag and jsdom check that toolbar rows/page controls are mounted/unmounted when toggled.
   - Status: implemented nav toggle; options saves; render/UI honors enable/disable and removes toolbars when off.

## Fixes and Hardening (Issue #31)
1. Stabilize bootstrap/render: audit `BootstrapOrchestrator` timing, ensure controllers mount after config load, and add logging/guards to catch render errors.
2. Make options reactive: propagate `ConfigService` updates immediately without requiring reloads.
3. Fix toolbar visibility load order so message/global toolbars render reliably.
4. Fix sidebar/project marker visibility by adjusting observer timing and retry strategy.
5. Fix unresponsive message toolbar buttons by hardening event wiring and DOM ownership checks.
6. Add regression checks for highlights/metadata/tagging to prevent selector drift.

# Fixes and Hardening

This last chapter can be complex, therefore let's give it its own chapter

## Step 1 Plan — Bootstrap/Render Stabilization
1. Instrument the bootstrap timeline: `configService.load` start/end, adapter selection, transcript root discovery, render attach, first render. Use guarded `console.info` with elapsed timings so noisy logs can be toggled.
2. Gate all controller mounting on a loaded config snapshot; fail fast if config load rejects and surface a lightweight banner/log so we do not partially mount.
3. Clarify the sequence inside `BootstrapOrchestrator.run`: teardown → adapter selection → container discovery (with retry if null) → config-aware UI mount (top panel, toolbars, overview) → render service attach → dom watcher attach. Add an early-return guard if SPA nav changed the path during the delay.
4. Wrap render entrypoints (`renderNow`/scheduler callback) in try/catch with a single error reporter that tags the current thread id/key; ensure we reset `running/queued` flags on error to avoid render deadlocks and optionally schedule a safe retry.
5. Harden DOM watcher/nav handling: ignore mutation batches while no container is attached; on root change, detach render/watchers before reattaching to the new root.
6. Add verification notes: (a) log timeline on first load and on SPA hop, (b) confirm toolbar/top panel/overview appear on first render after toggling config, (c) verify no uncaught errors in console during rapid nav + search typing.

### Step 1.6 Verification Notes
- Enable timing logs: set `window.__tagalystDebugBootstrap = true` in DevTools before reload; expect `[tagalyst][bootstrap]` lines for `run:start`, `config:load:*`, `adapter:selected`, `transcript:root`, `render:attach`, and `render:first` on initial load and after SPA navigation.
- Toggle config flags: via Options, flip nav toolbar/overview toggles, then reload a thread page; verify toolbar/top panel/overview mount on the first render after config loads (no extra manual refresh).
- Stress nav/search: rapidly switch chats (SPA) while typing in search; ensure no uncaught console errors and UI stays responsive. If errors occur, note thread id/path from log payloads.

## Step 2 Plan — Options Reactivity
Observation: Options writes to `chrome.storage.local` immediately and the content script already listens via `chrome.storage.onChanged → configService.apply`, so most toggles propagate without reload. Risks: partial writes that skip defaults, controllers that only mount on bootstrap, and stale UI when toggles flip quickly.
1. Verify live propagation: with a thread open, flip nav toolbar/overview/meta toolbar/sidebar labels/search/tags in Options; confirm content reacts without reload (toolbars/overview/panels appear/disappear, focus constraints enforced).
2. Harden `ConfigService.apply`: ensure it always merges defaults, tolerates being called before `load()`, and triggers necessary side effects (enforce focus constraints, remove toolbars when disabled) even for partial updates.
3. Force UI refresh on config change: after apply, re-run controller ensure/teardown paths (top panel, toolbars, overview, metadata) and schedule render; keep DOM operations idempotent to avoid duplicates.
4. Add regression tests: jsdom test to simulate `chrome.storage.onChanged` while a thread is mounted, asserting nav toolbar/overview/top panel state updates immediately; integration smoke to flip Options flags and observe DOM changes without page reload.
5. Document the live-update flow in `doc/DEV.md`: Options writes → storage change event → `ConfigService.apply` → controller updates + render; include a QA note on toggling flags live.

### Step 2.1 Verification — Are Options Already Reactive?
- Current behavior: Options toggles write immediately to `chrome.storage.local`; content script listens via `chrome.storage.onChanged` and calls `configService.apply`, which already merges defaults and triggers controller updates/render. In practice, nav toolbar/overview/sidebar/meta panels respond without a page reload.
- Gap to address in later steps: Options `saveConfig` writes the raw partial, so a single toggle can overwrite other settings with defaults; fix by merging with the stored snapshot before writing (tracked in Step 2.2).
- QA note: Keep a thread open, flip nav toolbar/overview/sidebar/meta toggles, and observe the UI updating live (no manual reload needed). This confirms the baseline reactivity path.

### Step 2.5 Docs — Live Update Flow
- Flow: Options page writes merged config → Chrome fires `storage.onChanged` (area `local`) → content script `configService.apply` merges defaults and marks loaded → controllers respond (top panel ensure/remove, overview ensure/reset, nav toolbar ensure/remove, metadata ensure/remove) → render is requested.
- QA toggle recipe: Open a thread, then in Options flip nav toolbar/overview/sidebar/meta/search/tags flags one at a time; expect toolbars/panels/overview/meta to appear/disappear within the same page session without reloading.

## Step 3 Plan — Toolbar Visibility Load Order
Goal: ensure message/global toolbars mount reliably and do not disappear during load or SPA nav.
1. Reproduce: instrument logs around toolbar ensure/teardown; observe scenarios where toolbars miss (slow load, SPA nav, toggling nav toolbar).
2. Guard injection order: only inject toolbars after config load and transcript root discovery; add idempotent ensure that removes stray duplicates and no-ops if already present.
3. Handle SPA/nav: on root swaps, reset toolbar controller and re-ensure page controls + per-message toolbars once render service attaches.
4. Add DOM ownership checks: ensure toolbar event handlers verify the target still belongs to the current container before acting; drop handlers on teardown.
5. Tests/QA: jsdom test that toggles nav toolbar + reruns render to confirm toolbars mount once; integration smoke that navigates (simulated root change) and checks toolbars persist; manual check on slow-load page.

### Step 3 Progress
- 3.1 Logging: added `__tagalystDebugToolbar` flag + lifecycle logs for page controls/toolbar inject/reuse/stale removal.
- 3.2 Ordering: `ensurePageControls` now reuses existing controls instead of tearing down; bootstrap/config/nav paths only mount when enabled and skip when disabled.
- 3.3 SPA nav: on SPA navigation, the DOM watcher reattaches to the new container before rendering, keeping observers aligned.
- 3.4 Ownership guards: toolbar actions (collapse, star, tag/note editors) bail out if the target is no longer inside the current transcript container, preventing stale-handler clicks.
- 3.5 Tests/QA: jsdom reactivity test added; manual slow-load check: enable `__tagalystDebugToolbar`, throttle network in DevTools, load a long thread, and verify page controls/toolbars appear once and stay mounted during initial load/SPA hop.

## Step 4 Plan — Sidebar/Project Markers Reliability
Goal: make sidebar/project markers consistently appear by hardening observer timing and retries.
1. Reproduce and instrument: add debug flag to log sidebar/project marker ensure/teardown and observer triggers; capture when markers are missing on slow loads or SPA nav.
2. Observer timing: ensure sidebar/project controllers start only after config load and transcript root detection; add a short retry/backoff if container or list nodes are missing.
3. SPA handling: on root change, stop old observers, reset controller state, and reattach to the new container/list before rendering markers.
4. Idempotent DOM: ensure marker injection/update functions are no-ops when markers already exist for a thread; remove stale markers on teardown.
5. Tests/QA: jsdom tests simulating late-mount sidebars/project lists and verifying markers appear after retry; integration smoke that navigates between project/thread pages and checks markers persist; manual slow-load check with debug logs enabled.
