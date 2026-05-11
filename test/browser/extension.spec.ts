import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import path from 'path';
import fs from 'fs';

// The unpacked extension is the repo root (manifest.json + built content/).
const EXTENSION_PATH = path.resolve(__dirname, '../..');
const FIXTURE_HTML = fs.readFileSync(path.resolve(__dirname, '../fixtures/thread.html'), 'utf8');
const THREAD_URL = 'https://chatgpt.com/c/6923021c-66f0-832d-bdec-b2184f14e304';

let context: BrowserContext;

test.beforeAll(async () => {
    if (!fs.existsSync(path.join(EXTENSION_PATH, 'content', 'content.js'))) {
        throw new Error('Extension not built. Run `npm run build` before the browser tests.');
    }
    // `channel: 'chromium'` selects the new headless mode, which supports extensions.
    context = await chromium.launchPersistentContext('', {
        channel: 'chromium',
        args: [
            `--disable-extensions-except=${EXTENSION_PATH}`,
            `--load-extension=${EXTENSION_PATH}`,
            '--no-sandbox',
        ],
    });
});

test.afterAll(async () => {
    await context?.close();
});

async function openThreadPage() {
    const page = await context.newPage();
    await page.route('https://chatgpt.com/**', route => {
        if (route.request().resourceType() === 'document') {
            return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FIXTURE_HTML });
        }
        return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
    });
    await page.goto(THREAD_URL, { waitUntil: 'domcontentloaded' });
    return page;
}

test('content script injects per-message toolbars on a ChatGPT thread', async () => {
    const page = await openThreadPage();
    await page.waitForSelector('.ext-toolbar', { timeout: 20_000 });
    const toolbars = await page.locator('.ext-toolbar').count();
    expect(toolbars).toBeGreaterThanOrEqual(6);
});

test('overlay UIs mount inside the extension shadow root', async () => {
    const page = await openThreadPage();
    await page.waitForSelector('#tagalyst-overlay-host', { timeout: 20_000 });
    const overlays = await page.evaluate(() => {
        const host = document.getElementById('tagalyst-overlay-host');
        const root = host?.shadowRoot;
        return {
            hasShadowRoot: !!root,
            hasRuler: !!root?.getElementById('ext-overview-ruler'),
            hasTopPanels: !!root?.getElementById('ext-top-panels'),
            hasPageControls: !!root?.getElementById('ext-page-controls'),
        };
    });
    expect(overlays.hasShadowRoot).toBe(true);
    expect(overlays.hasRuler).toBe(true);
    expect(overlays.hasTopPanels).toBe(true);
    expect(overlays.hasPageControls).toBe(true);
});

test('overview ruler renders one marker per message', async () => {
    const page = await openThreadPage();
    await page.waitForSelector('#tagalyst-overlay-host', { timeout: 20_000 });
    // Give the render scheduler a couple of frames to lay out markers.
    await page.waitForTimeout(1_000);
    const markerCount = await page.evaluate(() => {
        const root = document.getElementById('tagalyst-overlay-host')?.shadowRoot;
        return root?.querySelectorAll('.ext-overview-marker--message').length ?? 0;
    });
    // 3 prompt/response pairs -> 3 message markers.
    expect(markerCount).toBe(3);
});
