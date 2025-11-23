# Capturing ChatGPT pages as MHTML with Chrome DevTools Protocol

This folder holds the capture/mirroring tooling for saved HTML/DOM fixtures. Use Chrome with remote debugging enabled and the CDP-backed scripts here to capture MHTML and convert it to standalone HTML.

## Prereqs
- Chrome/Chromium installed.
- Node.js + `chrome-remote-interface` (`npm install chrome-remote-interface`).
- Launch Chrome with remote debugging, e.g. (use a throwaway profile):
  - macOS: `/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-mhtml`

## Batch capture (`capture.ts`)
- Define targets in `scripts/mirror/targets.json` as an array of `{ "name": "...", "url": "..." }`.
- Run the capture (from repo root):
  ```bash
  PORT=9222 npx ts-node scripts/mirror/capture.ts [--mirror]
  ```
  - Saves `<name>.mhtml` next to `targets.json`.
  - `--mirror` downloads externally referenced HTTP(S) resources (scripts, stylesheets, images, etc.) into `<name>_files/` and rewrites links inside the saved MHTML to point to the local copies (useful for offline fixtures).
  - `PORT` defaults to 9222 if not set.

## Converting MHTML to standalone HTML (`convert.ts`)
- Extract the HTML part and optionally keep CSS/JS resources:
  ```bash
  npx ts-node scripts/mirror/convert.ts scripts/mirror/Thread.mhtml scripts/mirror/Thread.html [--body] [--css] [--js] [--inline]
  ```
  - Output defaults to replacing `.mhtml` with `.html` if omitted.
  - `--body` trims to the `<body>` content.
  - `--css` keeps CSS parts; `--js` keeps JavaScript parts. By default these are exported to `<output>_files/` and linked.
  - `--inline` forces kept CSS/JS to stay inline (data URIs/styles/scripts) instead of being written to files.
  - Converter decodes quoted-printable/base64 parts, respects charset, and inlines `Content-Location` and `cid:` assets.

## Mirror helper (`mirror.ts`)
- Exposes `mirrorResources(html, baseName, assetDir)` which downloads external HTTP(S) resources referenced via `src=""`, `href=""`, or CSS `url(...)`, stores them under `<baseName>_files/`, and rewrites the HTML to point to the local copies. Used automatically when `capture.ts` runs with `--mirror`.

## Workflow
1) Start Chrome with `--remote-debugging-port=9222 --user-data-dir=/tmp/chrome-mhtml` and log into ChatGPT in that profile.
2) Add the URLs you want to capture to `targets.json`.
3) Run `capture.ts` (optionally with `--mirror`) to produce `.mhtml` fixtures.
4) Run `convert.ts` to create standalone HTML (use `--css/--js` to retain styling/behavior when needed).

## Authentication
- Use a separate Chrome profile (`--user-data-dir`) so you can sign into ChatGPT in the debug-enabled instance without affecting your main profile.
- Sessions/cookies persist in that temp profile between captures.

## Notes
- Ensure you start Chrome with remote debugging before running the capture script.
- For TypeScript, run via `ts-node` or compile to JS before running.
- Avoid using your main profile; keep captures isolated.
