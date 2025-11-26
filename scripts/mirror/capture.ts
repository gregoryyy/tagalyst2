import CDP = require('chrome-remote-interface');
import * as fs from 'fs';
import * as path from 'path';
import { mirrorResources } from './externals';

type Target = {
    name: string;
    url: string;
    mirrorExternals?: boolean;
    delayMs?: number;
    scrollToBottom?: boolean;
    scrollPasses?: number;
    waitSelector?: string;
    useLiveDom?: boolean;
};

const PORT = process.env.PORT ? Number(process.env.PORT) : 9222;
const DEFAULT_TARGETS = path.join(__dirname, 'targets.json');
const ARGS = process.argv.slice(2);

function getFlagValue(flags: string[]): string | undefined {
    const idx = ARGS.findIndex(arg => flags.includes(arg));
    if (idx === -1) return undefined;
    return ARGS[idx + 1];
}

const CUSTOM_TARGETS = getFlagValue(['--targets', '-t']);
const CUSTOM_OUT = getFlagValue(['--out', '-o']);
const TARGETS_FILE = CUSTOM_TARGETS ? path.resolve(CUSTOM_TARGETS) : DEFAULT_TARGETS;
const OUTPUT_DIR = CUSTOM_OUT ? path.resolve(CUSTOM_OUT) : __dirname;

type Resource = {
    url: string;
    type: string;
    frameId?: string;
    content?: string;
    base64Encoded?: boolean;
};

/**
 * Sanitize a target name into a safe file prefix.
 */
function sanitizeName(name: string) {
    return name.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'capture';
}

/**
 * Guess a sensible file extension for a resource.
 */
function extForResource(res: Resource): string {
    const parsed = new URL(res.url);
    const extFromPath = path.extname(parsed.pathname);
    if (extFromPath) return extFromPath;
    const type = res.type.toLowerCase();
    if (type.includes('script')) return '.js';
    if (type.includes('stylesheet') || type.includes('css')) return '.css';
    if (type.includes('image')) return '.png';
    if (type.includes('font')) return '.woff';
    return '.bin';
}

/**
 * Rewrite remote URLs in content to their local mirrored paths.
 */
function rewriteContent(content: string, urlMap: Map<string, string>) {
    let out = content;
    urlMap.forEach((local, remote) => {
        const safeRemote = remote.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        out = out.replace(new RegExp(safeRemote, 'g'), local);
    });
    return out;
}

/**
 * Wait until network goes idle (no in-flight requests for idleMs) or timeout.
 */
async function waitForNetworkIdle(client: any, idleMs = 2000, timeoutMs = 15000): Promise<void> {
    let inflight = 0;
    let idleResolve: (() => void) | null = null;
    let idleTimer: NodeJS.Timeout | null = null;

    const resetIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
            if (inflight === 0 && idleResolve) {
                idleResolve();
            }
        }, idleMs);
    };

    client.Network.requestWillBeSent(() => {
        inflight += 1;
        if (idleTimer) clearTimeout(idleTimer);
    });
    const onDone = () => {
        inflight = Math.max(0, inflight - 1);
        if (inflight === 0) resetIdle();
    };
    client.Network.loadingFinished(onDone);
    client.Network.loadingFailed(onDone);

    await new Promise<void>((resolve, reject) => {
        idleResolve = resolve;
        resetIdle();
        setTimeout(() => reject(new Error('Network idle timeout')), timeoutMs);
    }).catch(() => {});

    if (idleTimer) clearTimeout(idleTimer);
}

async function waitForSelector(client: any, selector: string, timeoutMs = 15000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const { result } = await client.Runtime.evaluate({
                expression: `!!document.querySelector(${JSON.stringify(selector)})`,
                returnByValue: true
            });
            if (result?.value) return;
        } catch {
            // ignore
        }
        await new Promise(res => setTimeout(res, 300));
    }
}

/**
 * Fetch resource contents via CDP.
 */
async function fetchResources(client: any, frameId: string, resources: Resource[]): Promise<Resource[]> {
    const { Page } = client;
    const fetched: Resource[] = [];
    for (const res of resources) {
        try {
            const { content, base64Encoded } = await Page.getResourceContent({ frameId: res.frameId || frameId, url: res.url });
            fetched.push({ ...res, content, base64Encoded });
        } catch {
            // skip resources we cannot fetch (cross-origin blocking etc.)
        }
    }
    return fetched;
}

/**
 * Mirror a single target: fetch HTML/resources, rewrite to local asset paths, and save.
 */
async function mirrorTarget(target: Target, port: number) {
    const client = await CDP({ port });
    const { Page, Network, Runtime } = client;
    await Promise.all([Page.enable(), Network.enable(), Runtime.enable()]);
    await Page.navigate({ url: target.url });
    await Page.loadEventFired();
    await waitForNetworkIdle(client).catch(() => {});
    if (target.waitSelector) {
        await waitForSelector(client, target.waitSelector).catch(() => {});
    }
    const passes = target.scrollPasses ?? (target.scrollToBottom ? 1 : 0);
    for (let i = 0; i < passes; i++) {
        try {
            await Runtime.evaluate({ expression: 'window.scrollTo(0, document.body.scrollHeight);' });
        } catch {
            // ignore scroll errors
        }
        await waitForNetworkIdle(client).catch(() => {});
    }
    const delay = target.delayMs ?? 8000;
    await new Promise(res => setTimeout(res, delay));
    await waitForNetworkIdle(client).catch(() => {});

    let liveDomHtml: string | null = null;
    if (target.useLiveDom !== false) {
        try {
            const { result } = await Runtime.evaluate({
                expression: 'document.documentElement.outerHTML',
                returnByValue: true
            });
            liveDomHtml = result?.value || null;
        } catch {
            liveDomHtml = null;
        }
    }

    const { frameTree } = await Page.getResourceTree();
    const mainFrameId = frameTree.frame.id;
    const mainFrameUrl = frameTree.frame.url;
    const resources: Resource[] = [];
    const collect = (tree: any) => {
        if (tree.resources) {
            resources.push(...tree.resources.map((r: any) => ({ url: r.url, type: r.type })));
        }
        if (tree.childFrames) tree.childFrames.forEach(collect);
    };
    collect(frameTree);

    const fetched = await fetchResources(client, mainFrameId, resources);
    // Ensure the main document is fetched even if not listed in resources (redirects/SPA).
    const hasMain = fetched.some(r => r.url === mainFrameUrl);
    if (!hasMain) {
        try {
            const { content, base64Encoded } = await Page.getResourceContent({ frameId: mainFrameId, url: mainFrameUrl });
            fetched.push({ url: mainFrameUrl, type: 'Document', content, base64Encoded });
        } catch {
            // ignore if not accessible
        }
    }
    await client.close();

    const safe = sanitizeName(target.name);
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const assetRelBase = `${safe}_assets`;
    const assetDir = path.join(OUTPUT_DIR, assetRelBase);
    if (!fs.existsSync(assetDir)) fs.mkdirSync(assetDir, { recursive: true });

    const urlMap = new Map<string, string>();
    let counter = 1;
    fetched.forEach(res => {
        const ext = extForResource(res);
        const fileName = `asset-${counter++}${ext}`;
        const relPath = `${assetRelBase}/${fileName}`;
        urlMap.set(res.url, relPath);
    });

    for (let i = 0; i < fetched.length; i++) {
        const res = fetched[i];
        const local = urlMap.get(res.url)!;
        const content = res.base64Encoded ? Buffer.from(res.content || '', 'base64') : Buffer.from(res.content || '', 'utf8');
        const absPath = path.join(OUTPUT_DIR, local);
        const dir = path.dirname(absPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        if (res.type.toLowerCase().includes('stylesheet')) {
            const text = content.toString('utf8');
            const rewritten = rewriteContent(text, urlMap);
            fs.writeFileSync(absPath, rewritten, 'utf8');
        } else {
            fs.writeFileSync(absPath, content);
        }
    }

    const mainRes =
        (liveDomHtml && ({ url: mainFrameUrl, type: 'Document', content: liveDomHtml, base64Encoded: false } as Resource)) ||
        fetched.find(r => r.url === mainFrameUrl) ||
        fetched.find(r => (r.type || '').toLowerCase().includes('document')) ||
        fetched[0];
    if (!mainRes || !mainRes.content) throw new Error(`Main document not captured for ${target.url}`);
    const htmlText = mainRes.base64Encoded ? Buffer.from(mainRes.content, 'base64').toString('utf8') : mainRes.content;
    let rewrittenHtml = rewriteContent(htmlText, urlMap);
    let externalsMap: Record<string, string> | null = null;
    if (target.mirrorExternals) {
        const externalRelBase = `${safe}_externals`;
        const externalDir = path.join(OUTPUT_DIR, externalRelBase);
        const mirrored = await mirrorResources(rewrittenHtml, safe, externalDir, externalRelBase);
        rewrittenHtml = mirrored.html;
        externalsMap = mirrored.map;
    }
    const htmlOut = path.join(OUTPUT_DIR, `${safe}.html`);
    fs.writeFileSync(htmlOut, rewrittenHtml, 'utf8');

    // Write mapping logs
    const assetsMapPath = path.join(OUTPUT_DIR, `${safe}_assets_map.json`);
    const assetsMapObj = Object.fromEntries(urlMap);
    fs.writeFileSync(assetsMapPath, JSON.stringify(assetsMapObj, null, 2), 'utf8');
    if (externalsMap) {
        const externalsMapPath = path.join(OUTPUT_DIR, `${safe}_externals_map.json`);
        fs.writeFileSync(externalsMapPath, JSON.stringify({ count: Object.keys(externalsMap).length, map: externalsMap }, null, 2), 'utf8');
    }
    // eslint-disable-next-line no-console
    console.log(`Mirrored ${target.url} to ${htmlOut}`);
}

/**
 * Read and validate targets from the JSON file.
 */
function readTargets(): Target[] {
    if (!fs.existsSync(TARGETS_FILE)) {
        throw new Error(`targets.json not found at ${TARGETS_FILE}`);
    }
    const raw = fs.readFileSync(TARGETS_FILE, 'utf8');
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
            await mirrorTarget(target, PORT);
        }
    } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Capture failed:', err);
        process.exit(1);
    }
})();
