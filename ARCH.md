# Tagalyst 2 Architecture Overview

This document explains how the current TypeScript rewrite is structured and how we are incrementally isolating ChatGPT‑specific DOM logic behind adapters so the rest of the extension can stay stable even if the site changes.

## High-Level Flow

```
bootstrap()
 └─ ChatGptThreadAdapter discovers DOM → builds MessageAdapter / PairAdapter objects
     ├─ Toolbar + focus UI injected into each message element
     ├─ Storage metadata cached (stars, tags, notes)
     ├─ FocusManager decides which adapters are “active”
     └─ Editors / toolbar actions update storage + refresh badges
```

The extension never re-parents ChatGPT nodes. Instead it overlays toolbars, editors, and floating panels on top of the existing DOM.

## Current Refactoring Steps

### 1. Thread Adapter Shell
- Added `ChatGptThreadAdapter` with the sole job of finding the transcript root, enumerating message elements, deriving (query, response) pairs, and wiring MutationObservers.
- The rest of the content script still called the classic helper functions, but those helpers were wired to defer to the adapter when available (`findTranscriptRoot`, `enumerateMessages`, `getPairs`, etc.). When the adapter is absent (during bootstrap teardown) we gracefully fall back to the old heuristics so behavior stays identical.

### 2. Message / Pair Adapters
- Introduced `DomMessageAdapter` and `DomPairAdapter` (along with ambient `MessageAdapter` / `PairAdapter` interfaces). These wrap each `HTMLElement`, exposing stable properties (`key`, `role`), normalized text, and collapse heuristics.
- The thread adapter now returns adapters instead of raw elements. Helpers such as `getFocusMatches`, `renderBadges`, the editors, and collapse logic consult the adapter metadata rather than re-reading the DOM every time. They still touch `adapter.element` when they need to inject UI.
- `messageState` stores adapters per element so focus/search/tag logic can reuse the same normalized text and identifiers (no more repeated `keyForMessage` calls).
- Navigation (focus jump, collapse-by-focus) now works with adapter sets and only converts back to DOM when scrolling.

These steps keep the external behavior unchanged—Chrome still loads `content/content.js` as a classic script—but drastically reduce the surface area that knows about ChatGPT’s internal structure.

## Next Steps

1. **Adapter-first Feature Modules** – Pass `MessageAdapter` instances directly into the toolbar and editor modules so they never recompute storage keys or scrape text manually.
2. **Service Layer Separation** – Lift storage/config/focus logic into discrete services that operate purely on adapters, making them unit-testable without the DOM.
3. **Pluggable DOM Adapters** – Once the feature layers depend only on adapters, we can implement alternative `ThreadAdapter` versions (e.g., for future ChatGPT layouts or other chat systems) without touching the UI logic.

Each refactoring should keep behavior 1:1, just like the previous steps, so we can ship incrementally without breaking the extension during the transition.
