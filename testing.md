# Testing Plan for Tagalyst 2

## Goals
- Cover pure utilities and services with unit tests (shared config/storage, content utils, render scheduling, focus logic).
- Exercise UI controllers in jsdom for DOM wiring sanity (Options page, select content controllers).
- Keep setup lightweight; add smoke E2E later only if needed.

## Setup
1. Add devDeps: `jest`, `ts-jest`, `@types/jest`, `ts-node` (if needed), and `jest-environment-jsdom`.
2. Install dev dependencies: run `npm install` to fetch Jest/ts-jest/typed deps before running tests.
3. Create `jest.config.js`:
   - `testEnvironment: 'jsdom'`
   - `preset: 'ts-jest'`
   - map `chrome` to a stub module
   - include a setup file to install global `chrome` mock.
4. Add a simple `test/mocks/chrome.ts` that fakes `chrome.storage.local` (get/set/clear) and any other APIs used.
5. Add npm scripts: `test`, `test:watch` (e.g., `jest --watch`).

## Unit Targets
6. `src/shared/config.ts`: default merge behavior, storage key consistency.
7. `src/shared/storage.ts`: read/write/clear contract with the chrome mock.
8. `src/content/utils.ts`: hashing, normalization, mutation filters (pure helpers).
9. `src/content/services/render-scheduler.ts`: request coalescing/timing (mock `requestAnimationFrame`).
10. `src/content/state/focus.ts`: mode transitions (stars/tags/search), selection toggle semantics.

## Controller Tests (jsdom)
11. Options: instantiate `OptionsController` against a minimal DOM fragment; assert toggles reflect config, status messaging, and that import/export/clear call the storage mock as expected (no real file APIs).
12. Content (targeted): small jsdom tests for toolbar/top-panel highlighting focus UI updates where feasible; mock MutationObserver and adapters to keep tests fast.

## Integration Lite
13. Optional follow-up: a tiny Playwright/Puppeteer smoke that loads a sample HTML thread and asserts injected UI appears; defer until unit/jsdom coverage is stable.

## Workflow
14. Run `npm test` locally; `npm run test:watch` during development.
15. Keep tests out of the build by scoping them via Jest config (no impact on `tsc -b`).
