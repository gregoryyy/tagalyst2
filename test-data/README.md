# Capturing ChatGPT pages as MHTML with Chrome DevTools Protocol

This folder holds saved HTML/DOM fixtures. To capture a full MHTML (including all dependencies) via Chrome’s DevTools Protocol (CDP), use Chrome with remote debugging enabled and a small Node script.

## Prereqs
- Chrome/Chromium installed.
- Node.js + `chrome-remote-interface` (`npm install chrome-remote-interface`).
- Launch Chrome with remote debugging, e.g.:
  - macOS: `/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-mhtml`

## Capture script (Node)
Example `test-data/download.ts` (requires ts-node or transpile first):
```ts
// npm install chrome-remote-interface
import CDP from 'chrome-remote-interface';

async function saveMhtml(targetUrl: string, outPath: string) {
  const client = await CDP({ target: targetUrl });
  const { Page } = client;
  await Page.enable();
  await Page.navigate({ url: targetUrl });
  await Page.loadEventFired();
  const { data } = await Page.captureSnapshot({ format: 'mhtml' });
  require('fs').writeFileSync(outPath, data);
  await client.close();
}

saveMhtml('https://chat.openai.com/', 'Thread.mhtml').catch(console.error);
```
If using CommonJS, require it instead:
```js
const CDP = require('chrome-remote-interface');
```

Run with ts-node:
```bash
npx ts-node test-data/download.ts
```
or transpile to JS first:
```bash
npx tsc test-data/download.ts --module commonjs --target es2020 && node test-data/download.js
```

## Batch capture via script
- Define targets in `test-data/targets.json` as `{ name, url }` objects (array).
- Use `test-data/capture.sh` to iterate and save MHTML files:
  - Start Chrome with remote debugging (`--remote-debugging-port=9222 --user-data-dir=/tmp/chrome-mhtml`), log into ChatGPT in that profile.
  - Run: `PORT=9222 bash test-data/capture.sh` (defaults to 9222). Outputs `<name>.mhtml` files into `test-data/` using each entry’s `name`.
  - Uses `test-data/download.js` (built from your TS script) under the hood; ensure `chrome-remote-interface` is installed.

## Converting MHTML to standalone HTML
- Use `test-data/convert.ts` to extract the HTML part and inline `cid:` assets as data URIs:
  ```bash
  npx ts-node test-data/convert.ts test-data/Thread.mhtml test-data/Thread.html
  ```
  (output defaults to replacing `.mhtml` with `.html` if omitted).

## Steps
1) Start Chrome with `--remote-debugging-port=9222`.
2) Open the target ChatGPT page in that Chrome instance (thread, project, etc.).
3) Run the capture script pointing to the open tab’s URL. The script uses `Page.captureSnapshot({ format: 'mhtml' })` to retrieve a full MHTML including dependencies (CSS/JS/assets).
4) The resulting `.mhtml` contains everything needed for offline fixtures (DOM + resources).

## Authentication
- Use a separate Chrome profile (`--user-data-dir`) so you can sign into ChatGPT in the debug-enabled instance without affecting your main profile.
- Manually log in once in that Chrome window; cookies/sessions will persist in the temp profile for subsequent captures.
- If you need to script login, automate the page interaction before calling `captureSnapshot`, but avoid embedding credentials in code.

## Notes
- Ensure you target the correct tab; `chrome-remote-interface` can list targets if needed.
- For TypeScript, run via `ts-node` or compile to JS before running.
- Avoid using your main profile; use a temporary `--user-data-dir` to keep captures isolated.
