# Mirroring ChatGPT pages with Chrome DevTools Protocol

This folder holds the mirroring tooling for saved HTML/DOM fixtures. Use Chrome with remote debugging enabled and the CDP-backed scripts here to mirror pages (HTML + resources) for offline use.

## Prereqs
- Chrome/Chromium installed.
- Node.js + `chrome-remote-interface` (`npm install chrome-remote-interface`).
- Launch Chrome with remote debugging, e.g. (use a throwaway profile):
  - macOS: `/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-mhtml`

## Site mirroring (`capture.ts`)
- Define targets in `scripts/mirror/targets.json` as an array of `{ "name": "...", "url": "..." }`.
- Run the mirror (from repo root):
  ```bash
  PORT=9222 npx ts-node scripts/mirror/capture.ts [--targets <file>] [--out <dir>]
  ```
  - Saves `<name>.html` plus `<name>_assets/` with all resources fetched via CDP; if external mirroring is enabled, additional assets go to `<name>_externals/`.
- `--targets` lets you point to a different targets file.
- `--out` chooses the output directory (defaults to the script directory).
- To additionally scan the resulting HTML for external HTTP(S) references and pull them down via `mirrorResources`, set `"mirrorExternals": true` per target in the targets file (useful if some assets were not in the CDP resource tree). Example:
  ```json
    {
      "name": "Thread",
      "url": "https://chatgpt.com/your/thread",
      "mirrorExternals": true,
      "delayMs": 8000,
      "scrollToBottom": true
    }
  ```
  - Use `"delayMs"` per target to control extra wait time after load (defaults to 8000ms) so slow pages can finish rendering before capture.
  - Set `"scrollToBottom": true` per target to trigger a scroll to the bottom before capture (helpful for lazy-loaded content).
  - The script also waits for a brief network-idle period after page load to reduce half-rendered captures.
- Uses Chrome DevTools Protocol to fetch the main document and all resources (`Page.getResourceContent`) and rewrites links to local copies for offline fixtures.
- `PORT` defaults to 9222 if not set.

## External mirroring helper (`externals.ts`)
- Exposes `mirrorResources(html, baseName, assetDir)` which downloads external HTTP(S) resources referenced via `src=""`, `href=""`, or CSS `url(...)`, stores them under `<baseName>_files/`, and rewrites the HTML to point to the local copies (for standalone HTML processing workflows).
- Can be run directly on a saved HTML page:
  ```bash
  npx ts-node scripts/mirror/externals.ts path/to/saved.html [baseName] [assetDir]
  ```
  This will mirror external resources into `<baseName>_externals/` (default) and rewrite the HTML in-place.

## Workflow
1) Start Chrome with `--remote-debugging-port=9222 --user-data-dir=/tmp/chrome-mhtml` and log into ChatGPT in that profile.
2) Add the URLs you want to capture to `targets.json`.
3) Run `capture.ts` to produce mirrored HTML + assets for offline fixtures (no MHTML involved).

## Authentication
- Use a separate Chrome profile (`--user-data-dir`) so you can sign into ChatGPT in the debug-enabled instance without affecting your main profile.
- Sessions/cookies persist in that temp profile between captures.

## Notes
- Ensure you start Chrome with remote debugging before running the capture script.
- For TypeScript, run via `ts-node` or compile to JS before running.
- Avoid using your main profile; keep captures isolated.
