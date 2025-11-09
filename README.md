# ChatGPT DOM Tools (MV3)


A Chrome extension that adds non-destructive UI on chat.openai.com to:
- Collapse/expand messages
- Tag and bookmark messages (local-only)
- Jump to first / last message


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
- The script is defensive (MutationObserver + heuristics). DOM changes on the site can still break selectors; update `isMessageNode` heuristics if needed.
- This extension never calls private ChatGPT APIs and avoids reparenting nodes, minimizing breakage.


## Roadmap
- Inline note editor per message
- Export visible thread to Markdown (DOM-only)
- Optional Shadow DOM for toolbar isolation