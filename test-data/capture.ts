import CDP = require('chrome-remote-interface');
import * as fs from 'fs';
import * as path from 'path';

type Target = { name: string; url: string };

const PORT = process.env.PORT ? Number(process.env.PORT) : 9222;
const TARGETS_PATH = path.join(__dirname, 'targets.json');

async function captureTarget(target: Target, port: number) {
    const client = await CDP({ port });
    const { Page } = client;
    await Page.enable();
    await Page.navigate({ url: target.url });
    await Page.loadEventFired();
    await new Promise(res => setTimeout(res, 10000));
    const { data } = await Page.captureSnapshot({ format: 'mhtml' });
    const safe = target.name.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'capture';
    const outPath = path.join(__dirname, `${safe}.mhtml`);
    fs.writeFileSync(outPath, data);
    // eslint-disable-next-line no-console
    console.log(`Saved ${outPath} from ${target.url}`);
    await client.close();
}

function readTargets(): Target[] {
    if (!fs.existsSync(TARGETS_PATH)) {
        throw new Error(`targets.json not found at ${TARGETS_PATH}`);
    }
    const raw = fs.readFileSync(TARGETS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
        throw new Error('targets.json must be an array of { name, url }');
    }
    parsed.forEach(entry => {
        if (!entry?.name || !entry?.url) {
            throw new Error('Each target requires name and url');
        }
    });
    return parsed as Target[];
}

(async () => {
    try {
        const targets = readTargets();
        for (const target of targets) {
            await captureTarget(target, PORT);
        }
    } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Capture failed:', err);
        process.exit(1);
    }
})();
