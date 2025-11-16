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
