# Issue #4 — Scalability & Toolbar Stability

## Goals
- Handle long threads (100–250 pairs) without UI jank; keep render passes comfortably under target budgets.
- Make per-message and global toolbars reliably visible/responsive across SPA navigation and config toggles.
- Reduce redundant work in the render loop (DOM scans, storage I/O, highlight churn) so search/tag modes stay quick.

## Current Risks / Findings
- Full render walks every message on each refresh: rebuilds transcript, clears registry/highlights, re-reads storage, re-runs `getText()` (length) and search highlighting for every node even when nothing changed.
- Search highlighting rewrites text nodes on every render when a query is set; no cache of previous query/hit set.
- Toolbar injection runs on every render; re-parses `innerHTML`, attaches handlers, and computes lengths per message. Message length is recomputed via `getText()` separately from transcript building.
- Storage reads fetch all message keys on every render; no in-memory cache keyed by thread generation.
- Overview/top-panel updates run every pass regardless of changes; render queue can accumulate during mutation bursts.
- Toolbar ownership is guarded, but mounting order depends on render timing; SPA/root swaps can momentarily drop toolbars/page controls.

## Additional Bug Fixes Needed
- Overview ruler: occasionally missing or rendered at the far-left overlaying nav (≈10% loads); in new chats the ruler bounds/thumb sizing drift upward off-screen as the thread grows.
- Overview ruler enhancement: message-length layout jumps noticeably on long threads when scrolling; pre-compute/normalize ruler layout so it stays stable before first scroll.
- Title toolbar: sometimes absent on load (~30%); new chats can show wrong titles; rename flow is brittle—remove inline rename and rely on ChatGPT titles only.
- Navigation toolbar: star buttons feel laggy on long chats and sometimes ignore clicks even while hover state updates; expand-after-collapse fails when using the button (keyboard shortcut still works).

## Plan
1. **Instrumentation & Baseline**
   1. Add optional perf traces (counts, render duration, search highlight time, toolbar inject time, overview-ruler mount/layout) gated by a debug flag.
   2. Capture a 200-message fixture run to establish current render time and jank points; add a budget note (e.g., <40ms cold render, <20ms steady-state) and log toolbar/ruler presence per load. Test added: `test/content/render-baseline.test.ts` (fixture-driven), logs `[tagalyst][perf-baseline]` with message/prompt counts, cold/steady render duration, toolbar injections, and overview ensure/update counts.

2. **Render Loop Efficiency**
   1. Cache transcript harvests per generation: memoize adapter list + message text/length hashes; reuse when DOM unchanged to avoid repeated `getText()`.
   2. Defer/skip work when inputs unchanged: skip search mark updates if query unchanged; reuse tag counts when storage unchanged.
   3. Move expensive work off the hot path: batch DOM writes (badges, lengths) via fragments/rAF; avoid clearing highlights/registry unless container or search query changes.

3. **Search Highlighting**
   1. Track last search query + hit map; only walk text nodes for messages that newly enter/leave hit sets.
   2. Prefer CSS Highlight API where available and fall back to minimal DOM spans; avoid replacing text nodes on every render.

4. **Overview Ruler Reliability**
   1. Mount ruler once per thread container with ownership tokens; assert placement next to content, never over nav.
   2. Pre-compute scroll-height map and message-length bands before first scroll; smooth-scale as messages append to avoid thumb/boundary jumps.
   3. Clamp thumb bounds when new messages arrive so the top edge cannot drift off-screen.

5. **Toolbar Stability & Laziness**
   1. Make title + per-message toolbar hydration idempotent with a version token; reuse existing rows without tearing down handlers; remove inline rename and rely on ChatGPT titles only.
   2. Lazy-create per-message toolbars via IntersectionObserver/viewport queue to avoid injecting all 200 at once; keep update paths for already-mounted rows.
   3. Ensure page controls mount once per container/threadKey and survive SPA root swaps; revalidate ownership before removal.
   4. Cache message lengths from transcript harvest so `updateMessageLength` is O(1); keep title toolbar bound to current thread title source.
   5. Keyboard shortcuts for navigation (arrows) now only work after clicking the thread text. This should also work after opening the page and interacting with the toolbars.

6. **Navigation Toolbar Quirks**
   1. Debounce star toggles with optimistic UI and coalesced storage writes; surface hover immediately and disable while pending to avoid lag.
   2. Ensure expand/collapse button toggles reinflate the nav container (not only shortcut); revalidate state after SPA swaps.
   3. Export does not currently work.

7. **Storage & Metadata**
   1. Add per-thread read-through cache for message metadata; avoid full `chrome.storage` reads on every render unless dirty keys changed.
   2. Batch writes from toolbar actions and editor saves; coalesce focus/tags/star writes where possible.

8. **Verification**
   1. Add jsdom load tests for 100/200-pair fixtures measuring render duration and ensuring toolbars/ruler exist once and stay placed.
   2. Add stability tests: SPA root swap + config toggles (nav toolbar on/off) should leave toolbars responsive; click actions remain wired; expand/collapse button recovers.
   3. Manual QA script: open long thread, enable debug timing, stress search/tag toggles and SPA nav; confirm no jank or missing toolbars/ruler; check ruler thumb/bounds don’t jump on scroll.
