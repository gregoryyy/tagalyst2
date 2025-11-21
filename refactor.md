# Content Script Refactor Plan

This layout keeps the current MV3 flow but splits the monolith into cohesive modules. Each module lives under `src/content/` (mirroring the existing `options` split) and exposes explicit exports so we can unit-test without spinning up the whole DOM.

## 1. Foundation

| Module | Purpose | Key Exports |
| --- | --- | --- |
| `content/constants.ts` | Shared literals (e.g., `EXT_ATTR`) so DOM helpers can mark extension nodes. | `EXT_ATTR` |
| `content/utils.ts` | Stateless helpers: hashing, caret placement, floating editors, mutation filters, thread key helpers. | `hashString`, `normalizeText`, `placeCaretAtEnd`, `mountFloatingEditor`, `mutationTouchesExternal`, etc. |
| `content/types.ts` | Optional re-exports of shared type guards/interfaces to shrink long triple-slash refs. | `MessageMeta`, `MessageValue`, etc. |

## 2. Services & State

| Module | Purpose | Key Exports |
| --- | --- | --- |
| `content/services/storage.ts` | Wraps `chrome.storage` with per-message helpers. | `StorageService`, `MessageValue` |
| `content/services/render-scheduler.ts` | Handles RAF-throttled rendering of mutation work. | `RenderScheduler` |
| `content/services/config.ts` | Loads/persists config toggles; emits change events. | `ConfigService`, `contentDefaultConfig`, `CONTENT_CONFIG_STORAGE_KEY` |
| `content/state/message-meta.ts` | Stores metadata per DOM node, exposes registry operations. | `MessageMetaRegistry`, `MessageMeta` |
| `content/state/focus.ts` | Focus logic plus focus controller (currently `FocusService` + `FocusController`). | `FocusService`, `FocusController`, `focusMarkerColors` |

## 3. DOM Adapters

| Module | Purpose | Key Exports |
| --- | --- | --- |
| `content/dom/message-adapters.ts` | `DomMessageAdapter` and `DomPairAdapter`. | `DomMessageAdapter`, `DomPairAdapter` |
| `content/dom/thread-dom.ts` | `ThreadDom` plus helper discovery methods. | `ThreadDom` |
| `content/dom/chatgpt-adapter.ts` | `ChatGptThreadAdapter` (bridge to the real DOM). | `ChatGptThreadAdapter` |

## 4. UI Controllers

| Module | Purpose | Key Exports |
| --- | --- | --- |
| `content/controllers/top-panel.ts` | Search + tag panel. | `TopPanelController` |
| `content/controllers/overview-ruler.ts` | Ruler rendering + marker layout. | `OverviewRulerController` |
| `content/controllers/editor.ts` | Tag + note editors. | `EditorController` |
| `content/controllers/highlight.ts` | Highlight selection, hover tooltips. | `HighlightController` |
| `content/controllers/toolbar.ts` | Per-message toolbar + page controls. | `ToolbarController` |
| `content/controllers/thread-actions.ts` | Collapse/expand logic. | `ThreadActions` |
| `content/controllers/export.ts` | Markdown exporting, including `MarkdownSerializer` glue. | `ExportController` |

Each controller receives constructor dependencies instead of reaching for globals—e.g., `ToolbarController` takes `{ focusController, storageService, editorController, threadActions, overviewRulerController }`.

## 5. Bootstrap & Orchestration

| Module | Purpose | Key Exports |
| --- | --- | --- |
| `content/bootstrap/overlays.ts` | Wires `focusController` events to UI controllers (e.g., update top panel on focus change). | `attachOverlayListeners` |
| `content/bootstrap/orchestrator.ts` | Current `BootstrapOrchestrator` extracted into its own file. | `BootstrapOrchestrator` |
| `content/index.ts` | Thin entrypoint: instantiate services/controllers, call orchestrator, expose `window.__tagalyst`. | (no exports; executed by MV3) |

## 6. Supporting Files

| Module | Purpose |
| --- | --- |
| `content/styles/` (optional) | If/when CSS is compiled from SCSS/TS modules, keep it alongside controllers that inject fragments. |
| `refactor.md` | This plan; update as modules migrate. |

## Migration Strategy

1. **Foundation First**: Move `constants.ts`/`utils.ts` + services into new files so everything else can import them. Update `tsconfig/content.json` include path (`src/content/**/*.ts` already works).
2. **State & Focus**: Extract `MessageMetaRegistry`, `FocusService`, `FocusController`. Ensure they take dependencies via constructors, not globals.
3. **DOM Layer**: Move adapters (`DomMessageAdapter`, `ThreadDom`, `ChatGptThreadAdapter`). Update orchestrator imports.
4. **Controllers**: Split UI controllers one at a time. After each extraction, run `npm run build`.
5. **Bootstrap Rewrite**: Create `content/index.ts` that wires everything, registers mutation observers, and handles SPA navigation + `window.__tagalyst`.
6. **Cleanup**: Delete leftover unused helpers, convert global singletons to module-local instances in the new files, and update manifest outputs if bundle paths change.

This layout mirrors typical extension architectures and gives natural seams for tests (e.g., jest-dom for focus/controller logic without hitting Chrome APIs).

## Post-Refactor content.ts

Once the modules above exist, `src/content.ts` shrinks to a thin entrypoint:

- Import the new services/controllers/adapters and instantiate them (no class definitions remain).
- Create the `BootstrapOrchestrator`, call `run()`, and wire SPA re-bootstrap + `chrome.storage.onChanged`.
- Attach overlay listeners (focus → top panel, overview ruler, etc.).
- Expose the public API (`window.__tagalyst`) and nothing else.

All business logic lives in the dedicated modules; `content.ts` becomes straightforward glue.
### Why not just move classes?

Simply copying existing classes into separate files would still leave them tightly coupled to global singletons (`focusController`, `messageMetaRegistry`, etc.). The planned layout goes further: each module exposes explicit exports, consumes dependencies through constructors, and drops side effects so we can test or replace pieces without dragging in the whole content script. That’s why the refactor is more than a file shuffle—it’s also about untangling ownership and wiring while we split the code.

## Step 4 Breakdown (UI Controllers)

Split one controller at a time, running `npm run build` after each move. Suggested order:

1. **TopPanelController** → `controllers/top-panel.ts` (inject `focusService`, `configService`, `focusController`).
2. **OverviewRulerController** → `controllers/overview-ruler.ts` (inject `focusController`, `highlightController` as needed).
3. **EditorController** → `controllers/editor.ts` (inject `storageService`, `toolbarController` hooks).
4. **HighlightController** → `controllers/highlight.ts`.
5. **ToolbarController** → `controllers/toolbar.ts` (takes focus/editor/thread actions/export deps).
6. **ThreadActions** + **ExportController** → `controllers/thread-actions.ts` / `controllers/export.ts`.

Each extraction removes the class from `content.ts`, moves it into the controller file with constructor-based dependencies, adds its compiled JS to the manifest, and verifies the build. After all six, `content.ts` just wires the controllers together.


## Codebase overview

- Purpose: MV3 overlay for ChatGPT threads: right-side toolbars, top search/tag panels, bottom nav stack, Markdown export, text highlights/annotations, and an overview ruler.
- Build/outputs: TypeScript in `src/` emits plain JS/CSS to `content/` via `tsconfig/content.json`; `manifest.json` loads the compiled scripts in a fixed order; no bundler.
- Entrypoints/orchestration: `src/content.ts` constructs services/controllers, runs `BootstrapOrchestrator` (storage batch read, UI injection, focus/ruler sync, SPA reboots), and exposes `window.__tagalyst`.
- Services/state: storage/config/render-scheduler; message meta registry; focus service/controller modeling stars/tags/search modes.
- DOM layer: `ThreadDom`, `ChatGptThreadAdapter`, and message/pair adapters abstract ChatGPT discovery/pairing; fallback heuristics live in `ThreadDom`.
- UI controllers: toolbar, thread-actions (collapse/expand), export (Markdown), top-panel (Search/Tags), highlight (CSS Highlight API + hover annotations), overview-ruler, editor (tags/notes); all use constructor-injected deps.
- Options page: `src/options.ts` → `options/` toggles search/tags and handles storage view/import/export/delete with size display.
- Docs/testing: `README.md` (UX + dev loop), `ARCH.md`/`refactor.md` (module plan), `TODO.md` (bugs/roadmap); tests mentioned (Jest) but none present.


## Codebase review

- Strengths: clear MV3 extension shape; services/controllers separated; manifest includes compiled outputs; storage/config abstractions keep chrome APIs isolated; overview ruler and highlight features already modular.
- Risk spots: `src/content.ts` still hosts orchestration and globals; triple-slash refs everywhere complicate imports; no automated tests despite Jest mention; build order in `manifest.json` must stay aligned with split modules; network sandbox errors (`/bin/ps` not permitted) show up in shellenv but harmless.
- Refactor focus: finish moving classes into modules (bootstrap/index + overlays wiring), drop globals in favor of dependency injection, prune triple-slash references, and wire a minimal Jest target for utilities/focus logic.
- Validation: rely on `npm run build` and a manual Chrome smoke pass until tests exist; ensure Options affects content-config flow after wiring.

