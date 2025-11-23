# Issue #25: Thread Labels in Global/Project Overviews

## Goal
Surface per-thread labels (stars, tags/annotations, size) directly in the ChatGPT sidebar/global nav and project overview lists, so threads are recognizable without opening them.

## Context / Requirements
- Show a star marker for starred threads.
- Show tags/annotations (reuse thread metadata from Issue #11).
- Show size:
  - (a) after a thread has been opened with the extension (we have message count/char data).
  - (b) optionally after an indexing pass (future enhancement).
- Apply to both global conversation list and project conversation list; not on the project overview grid for now.

## Proposed Approach
1) **Selectors & Scope**
   - Sidebar rows: `nav [data-testid^="history-item-"]` (kebab buttons carry `data-testid="history-item-<n>-options"`); find the enclosing row/link to attach badges.
   - Project vs global: detect current URL (`/c/...` vs `/g/.../c/...`) and include project id in storage keys.
2) **State & Storage**
   - Reuse `ThreadMetadataService` keys for starred/tags/notes/size/length/chars.
   - Derive thread id from link href (`/c/<id>`); derive project id from `/g/<project>/`.
3) **Rendering**
   - Inject a small badge container into each row (non-destructive): star icon if `starred`; tag/annotation count or preview; size badge (e.g., `8 prompts`, `12k chars`).
   - Use the same badge styling as existing toolbars (pill/outline).
4) **Observation / Refresh**
   - Debounced `MutationObserver` on the sidebar list; reapply on SPA URL changes and `visibilitychange`.
   - Handle virtualized lists: clear/reapply on node reuse; mark injected nodes with `data-ext` to avoid duplication.
5) **Indexing (optional)**
   - Leave hook for a background index pass to precompute size; for now, only show size for threads previously opened (metadata available).
6) **Config / Opt-out**
   - Gate with a config flag (e.g., `sidebarLabelsEnabled`), default on.

## Implementation Steps
1. Add `sidebarLabelsEnabled` to shared config and options UI (checkbox, no expand). **Done.**
2. Create a `SidebarLabelController` (content): observe `nav` for history items, map href -> thread id, fetch metadata, and inject badges (star/tags/size). **Done:** labels render on all conversation links in the left sidebar when enabled.
3. Wire controller into `content.ts` bootstrap and config change listener; keep running on all pages (no teardown) so labels stay visible. **Done.**
4. Reuse `ThreadMetadataService` data; add a helper to format size (`prompts`, `chars`). **Done:** prompt counts shown as `(N)`; chars formatted like message badges.
5. (Optional) Add an indexer stub for future size prefetch; currently only show size when metadata exists. **Not done.**
6. Add `ProjectListLabelController` to render the same metadata line in the right-hand project thread list (stars, tags, note text, prompts/chars when known). **Done**, with delayed retries to catch late-loaded lists.
