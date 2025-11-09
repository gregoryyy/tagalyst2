# Tagalyst 2: ChatGPT DOM Tools (MV3)

A Chrome extension that adds non-destructive UI on chat.openai.com / chatgpt.com to:
- Collapse/expand any multi-line message with a per-message toolbar
- Tag and bookmark messages locally with an inline editor
- Attach free-text annotations to individual messages (stored locally)
- Jump to first/last message or only starred messages via the floating nav
- Batch collapse/expand all, starred-only, or unstarred-only messages

Note: Tagalyst 1 was not robust in the insane ChatGPT frontend structure. This version makes only light-weight assumptions and restricts to list item-level operations not actual text highlighting.


## Install (Developer Mode)
1. Clone or copy this folder.
2. Ensure the following files exist:
- manifest.json
- content/content.js
- content/content.css
- icons/icon16.png, icon32.png, icon48.png, icon128.png (placeholders OK)
3. Open `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the folder.


## Notes
- Data is stored locally via `chrome.storage.local` keyed by `{threadKey}:{messageKey}`.
- Whenever ChatGPT exposes `data-message-id` on a message, that UUID becomes the `{messageKey}` input so the backend (or other tools) can correlate records 1:1. If the attribute is missing we fall back to a hash of the message text + position.
- Message blocks are discovered via the stable `data-message-author-role` attribute (user / assistant) that ChatGPT renders on every turn. If that attribute disappears, the content script falls back to the old heuristics in `isMessageNode`.
- The script is defensive (MutationObserver + heuristics). DOM changes on the site can still break selectors; update `isMessageNode` heuristics if needed.
- This extension never calls private ChatGPT APIs and avoids reparenting nodes, minimizing breakage.
- When switching chats the extension tears down and rebuilds its UI automatically, so you can move between projects without stale controls.

## Terminology & Pair API
- **Thread** (`t`) is the ordered list of conversational exchanges. (Use “session” only when referring to time-bounded usage, not the DOM thread.)
- **Pair** (`p = (q, r)`) is a single user query `q` and its assistant response `r`. There are currently no response variants, so `t = [p₀, p₁, …]`.

The content script exposes a tiny helper API for debugging or other extensions:

```js
// Return all pairs in the current thread
window.__tagalyst.getThreadPairs(); // => [{ query, queryId, response, responseId }, ...]

// Return the p-th pair (0-indexed). Useful notation: p_i = getThreadPair(i).
window.__tagalyst.getThreadPair(3);
```

These helpers respect the same discovery logic as the UI (preferring `data-message-author-role` and falling back to heuristics).


## Roadmap
- Inline note editor per message
- Export visible thread to Markdown (DOM-only)
- Optional Shadow DOM for toolbar isolation
