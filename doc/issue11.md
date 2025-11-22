# Issue #11: Project/Global Toolbar Above Threads

## Goals
- Add a toolbar that sits above the thread list (project overview) and/or above the active thread view to manage threads globally.
- Provide thread-level metadata: name, size (message count), tags, annotations.
- Allow listing threads with size, tagging/annotating threads, and viewing metadata (hover or overlay).
- Support both project threads (`/g/.../c/...`) and regular threads (`/c/...`); skip project overview (`/g/.../project`).

## Proposed Approach

### Page Classification
- Reuse the `PageClassifier` to detect:
  - `thread` (non-project conversation)
  - `project-thread` (conversation inside a project)
  - `project` (overview) and `unknown` (no injection)
- Only attach the new toolbar on `thread` and `project-thread`.

### Data Model (Thread Metadata)
- Store thread-level metadata in `chrome.storage.local` keyed by thread ID (derived from URL or UUID if available).
- Metadata fields:
  - `name` (user-provided; default empty since ChatGPT hides it)
  - `tags: string[]`
  - `note: string` (annotation)
  - `size: number` (message count; compute and cache)
- Add helper in `StorageService` for thread-level get/set keyed by thread id.
- Question: How to determine the thread size in messages and bytes? Do we need to open it? This would require an indexing operation...

### UI Layers
1) **Global/Project Toolbar**
   - Appears above the thread list (overview) or at top of conversation page.
   - Sections:
     - Thread list: title + size (message count), sortable by date/size/name.
     - Tag/Annotation chips per thread; inline edit or hover overlay to edit.
     - Quick actions: open thread (link), focus in list, copy link.
   - For project overview: disabled (per request), but keep code ready to enable if needed later.
2) **Thread Header Metadata**
   - Inject a small header in the active thread:
     - Editable name field (persistent).
     - Tag pills + inline add/remove.
     - Note/annotation textarea (inline or overlay).
     - Size display (recomputed on load).
   - Hover shows metadata; click to edit.

### Interaction Patterns
- Editing:
  - Name: inline input on click; saves on Enter or blur.
  - Tags: reuse tag editor UI (comma-separated, Enter to save).
  - Note: reuse textarea editor (Enter to save for thread-level notes; Esc to cancel).
- Metadata overlay:
  - Hover/click shows a compact overlay with name, tags, note, size.

### Controllers/Services
- **ThreadMetadataService** (new):
  - `readThreadMeta(threadId)`, `writeThreadMeta(threadId, meta)`, `updateSize(threadId, count)`.
- **ThreadMetadataController** (new):
  - Injects thread header UI in active thread.
  - Hooks into existing `BootstrapOrchestrator` render to compute size from adapters.
- **ThreadListController** (new, optional placeholder):
  - For global/project toolbar; lists threads with metadata; initially only for conversation pages; project overview attach is deferred.

### Rendering Hooks
- During bootstrap render:
  - Compute thread size from message adapters and update `ThreadMetadataService`.
  - Inject header UI in conversation view.
  - If/when global toolbar is enabled, populate thread list from storage entries keyed by thread IDs.

### Edge Cases
- Threads without stable IDs: derive from URL + index fallback (hash) as currently used in storage keys.
- SPA navigation: rely on the existing MutationObserver/URL poller to teardown/re-attach.
- Permissions: uses `chrome.storage.local` only; no new permissions.

### Implementation steps
1. Add `ThreadMetadataService` (storage helpers) + `threadId` helper (from URL).
2. Add `ThreadMetadataController` to inject editable header in conversations. **Done:** header renders name/tags/note/length and auto-syncs length from message count during bootstrap.
3. Add optional global/project toolbar scaffold (hidden/disabled for overview per current scope).
4. Wire into `content.ts` after bootstrap to compute size and render header; guard by page kind (`thread`, `project-thread`). **Done:** injected during bootstrap with page classifier gating.
