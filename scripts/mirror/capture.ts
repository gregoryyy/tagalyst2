import CDP = require('chrome-remote-interface');
import * as fs from 'fs';
import * as path from 'path';
import { mirrorResources } from './mirror';

type Target = { name: string; url: string };

const PORT = process.env.PORT ? Number(process.env.PORT) : 9222;
const TARGETS_PATH = path.join(__dirname, 'targets.json');
const ARGS = process.argv.slice(2);
const MIRROR = ARGS.includes('--mirror');

type MhtmlPart = {
    headers: Record<string, string>;
    headerLines: string[];
    body: string;
};

function decodeQuotedPrintableToBuffer(input: string): Buffer {
    const str = input.replace(/=\r?\n/g, '');
    const bytes: number[] = [];
    for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        if (ch === '=' && i + 2 < str.length) {
            const hex = str.slice(i + 1, i + 3);
            if (/^[A-Fa-f0-9]{2}$/.test(hex)) {
                bytes.push(parseInt(hex, 16));
                i += 2;
                continue;
            }
        }
        bytes.push(str.charCodeAt(i));
    }
    return Buffer.from(bytes);
}

function parseCharset(contentType: string | undefined): string {
    if (!contentType) return 'utf-8';
    const match = contentType.match(/charset="?([A-Za-z0-9._-]+)"?/i);
    return (match && match[1]) ? match[1].toLowerCase() : 'utf-8';
}

function parseMhtml(raw: string): { preamble: string; boundary: string; parts: MhtmlPart[] } {
    const boundaryMatch = raw.match(/boundary="?([^\";\r\n]+)"?/i);
    if (!boundaryMatch) throw new Error('Boundary not found in MHTML');
    const boundary = boundaryMatch[1];
    const boundaryToken = `--${boundary}`;
    const segments = raw.split(boundaryToken);
    const preamble = segments.shift() || '';
    const parts = segments
        .filter(s => s && !s.trim().startsWith('--'))
        .map(segment => {
            const trimmed = segment.replace(/^\r?\n/, '').replace(/\r?\n$/, '');
            const [rawHeaders, ...rest] = trimmed.split(/\r?\n\r?\n/);
            const body = rest.join('\r\n\r\n').replace(/^\r?\n/, '');
            const headerLines = rawHeaders.split(/\r?\n/);
            const headers: Record<string, string> = {};
            headerLines.forEach(line => {
                const idx = line.indexOf(':');
                if (idx > -1) {
                    const key = line.slice(0, idx).trim().toLowerCase();
                    const val = line.slice(idx + 1).trim();
                    headers[key] = val;
                }
            });
            return { headers, headerLines, body };
        });
    return { preamble, boundary, parts };
}

function decodePartBody(part: MhtmlPart): Buffer {
    const encoding = part.headers['content-transfer-encoding'] || '';
    if (/base64/i.test(encoding)) {
        return Buffer.from(part.body.replace(/\s+/g, ''), 'base64');
    }
    if (/quoted-printable/i.test(encoding)) {
        return decodeQuotedPrintableToBuffer(part.body);
    }
    return Buffer.from(part.body, 'binary');
}

function serializeHeaders(lines: string[], headers: Record<string, string>): string {
    const seen = new Set<string>();
    const updated = lines.map(line => {
        const idx = line.indexOf(':');
        if (idx === -1) return line;
        const key = line.slice(0, idx).trim().toLowerCase();
        seen.add(key);
        const val = headers[key];
        return `${line.slice(0, idx)}: ${val}`;
    });
    Object.entries(headers).forEach(([key, val]) => {
        if (!seen.has(key)) {
            updated.push(`${key}: ${val}`);
        }
    });
    return updated.join('\r\n');
}

function rebuildMhtml(preamble: string, boundary: string, parts: MhtmlPart[]): string {
    const boundaryToken = `--${boundary}`;
    let output = preamble.trimEnd();
    if (!output.endsWith('\n')) output += '\r\n';
    parts.forEach(part => {
        output += `${boundaryToken}\r\n`;
        output += `${serializeHeaders(part.headerLines, part.headers)}\r\n\r\n`;
        output += `${part.body.replace(/\r?\n/g, '\r\n')}\r\n`;
    });
    output += `${boundaryToken}--`;
    return output;
}

async function mirrorMhtmlResources(rawMhtml: string, baseName: string): Promise<string> {
    const { preamble, boundary, parts } = parseMhtml(rawMhtml);
    const htmlPart = parts.find(p => (p.headers['content-type'] || '').toLowerCase().includes('text/html'));
    if (!htmlPart) return rawMhtml;

    const charset = parseCharset(htmlPart.headers['content-type']);
    let html: string;
    try {
        const decoder = new TextDecoder(charset);
        html = decoder.decode(decodePartBody(htmlPart));
    } catch {
        html = htmlPart.body.toString();
    }

    const assetDir = path.join(__dirname, `${baseName}_files`);
    const mirroredHtml = await mirrorResources(html, baseName, assetDir);
    const encoded = Buffer.from(mirroredHtml, charset as BufferEncoding).toString('base64');
    htmlPart.headers['content-transfer-encoding'] = 'base64';
    htmlPart.body = encoded;

    return rebuildMhtml(preamble, boundary, parts);
}

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
    const finalData = MIRROR ? await mirrorMhtmlResources(data, safe) : data;
    fs.writeFileSync(outPath, finalData);
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
