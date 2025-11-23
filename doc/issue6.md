# Issue #6: Cross-Thread Search and Indexing

## Prerequisite
Highlight search

## Goal
Provide a unified search across all ChatGPT threads (global and project) that combines raw conversation text with Tagalyst metadata (focus, highlights, annotations, tags, stars).

## Requirements (from brief)
- Initial indexing:
  - Crawl all conversations (global and project).
  - Convert to text/Markdown.
  - Merge Tagalyst data (focus/highlights/annotations/tags/stars).
- Live updates:
  - Index new threads as they appear.
  - Optionally intercept ChatGPT internal API traffic to avoid DOM scraping.
- Retrieval:
  - Search entry points in thread/project/nav views.
  - Results via popup/list or by filtering/highlighting the navigation list.
- Design:
  - Adapter to abstract ChatGPT-specific harvesting.
  - IndexedDB (in-extension) or backend agent for storage.
  - Client-side engine (lunr/elasticlunr or similar).

## Open Questions / Assumptions
- How many threads to index (storage/quotas)? IndexedDB limits apply; large accounts may require backend.
- Privacy/permissions: API interception may need host permissions or declarativeNetRequest; DOM crawl is safer but slower.
- Result UX: inline nav filtering vs. modal list; needs performance guards for large result sets.

## Proposed Architecture
1) **Harvest Adapter Layer**
   - DOM-based thread scraper (reuse existing message adapters + markdown export) for initial implementation.
   - Interface allows swapping to API-based capture later.
2) **Indexer**
   - Per-thread document: { threadId, projectId?, title, prompts/responses text, annotations, tags, stars, highlights, timestamp, size, chars }.
   - Store raw doc + a prebuilt search index (lunr/elasticlunr) in IndexedDB. Consider sharding by project.
3) **Index Manager**
   - Initial crawl: iterate conversation links (sidebar + project lists), open fetch via a lightweight fetch/DOM parse (not user-visible) or background page scrape; throttle to avoid rate limits.
   - Incremental updates: hook SPA nav/URL changes to reindex current thread after load; add optional network interception hook for future.
4) **Search Service**
   - Wrap engine (lunr/elasticlunr) with fields: title, body, tags, annotations, highlights, stars flag.
   - Query API returns top hits with snippet + link.
5) **UI Integration**
   - Add a search affordance (toolbar button) in thread/project/nav views.
   - Render results in a lightweight popup overlay; optionally filter nav/sidebar to matching threads.
   - Offer “reindex” control in options.

## Implementation Plan
1. Add `SearchIndexService` with IndexedDB-backed storage; schema for documents and index blobs; lunr/elasticlunr wrapper.
2. Add `ThreadHarvestAdapter` (DOM) that:
   - Collects thread title/id/project id, messages (text), annotations/tags/stars/highlights from `ThreadMetadataService`/message metadata, and length/chars.
   - Produces a normalized doc for indexing.
3. Add `IndexManager`:
   - Initial crawl: enumerate links from sidebar/project lists; sequentially harvest and index with throttling; persist progress.
   - Incremental: on thread load (bootstrap), harvest and update index; skip if unchanged hash.
4. UI:
   - Add a search entry point (button in nav/project/thread toolbar) that opens a modal/popup listing results; link to thread, optional nav filtering.
   - Add Options toggle for search + “Reindex all” action.
5. Engine tuning:
   - Start with lunr/elasticlunr client-side; shard indexes by project if needed.
   - Expose a tiny API for querying (fields weighted: title > tags/annotations > body).
6. (Optional) Network intercept hook for future:
   - Define interface; implement later if permissions allow.

## Out of Scope for Now
- Backend agent / remote index.
- Full API interception until permissions/feasibility are clarified.
- Project overview grid tooling beyond labels already planned in Issue #25.
