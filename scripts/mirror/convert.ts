import * as fs from 'fs';
import * as path from 'path';

type Part = {
    headers: Record<string, string>;
    body: Buffer;
};

function decodeQuotedPrintableToBuffer(input: string): Buffer {
    // Remove soft line breaks (=`\r\n`)
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

function escapeRegex(str: string) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseCharset(contentType: string | undefined): string {
    if (!contentType) return 'utf-8';
    const match = contentType.match(/charset="?([A-Za-z0-9._-]+)"?/i);
    return (match && match[1]) ? match[1].toLowerCase() : 'utf-8';
}

function parseMhtml(filePath: string): Part[] {
    // Read as binary string to preserve raw bytes.
    const raw = fs.readFileSync(filePath, 'binary');
    const boundaryMatch = raw.match(/boundary="?([^\";\r\n]+)"?/i);
    if (!boundaryMatch) throw new Error('Boundary not found in MHTML');
    const boundary = boundaryMatch[1];
    const sections = raw.split(`--${boundary}`).filter(s => s && s.trim() && s.trim() !== '--');

    return sections.map(section => {
        const [rawHeaders, ...rest] = section.split(/\r?\n\r?\n/);
        const body = rest.join('\n\n').replace(/^\r?\n/, '');
        const headers: Record<string, string> = {};
        rawHeaders.split(/\r?\n/).forEach(line => {
            const idx = line.indexOf(':');
            if (idx > -1) {
                const key = line.slice(0, idx).trim().toLowerCase();
                const val = line.slice(idx + 1).trim();
                headers[key] = val;
            }
        });
        const contentTransfer = headers['content-transfer-encoding'] || '';
        let buf: Buffer;
        if (/base64/i.test(contentTransfer)) {
            buf = Buffer.from(body.replace(/\s+/g, ''), 'base64');
        } else if (/quoted-printable/i.test(contentTransfer)) {
            buf = decodeQuotedPrintableToBuffer(body);
        } else {
            buf = Buffer.from(body, 'binary');
        }
        return { headers, body: buf };
    });
}

function inlineCid(html: string, parts: Part[]) {
    const cidMap: Record<string, { mime: string; data: string }> = {};
    parts.forEach(p => {
        const cid = (p.headers['content-id'] || '').replace(/[<>]/g, '');
        if (!cid) return;
        const mime = p.headers['content-type']?.split(';')[0] || 'application/octet-stream';
        cidMap[cid] = { mime, data: p.body.toString('base64') };
    });
    return html.replace(/cid:([^"')\s]+)/g, (_m, cid) => {
        const entry = cidMap[cid];
        if (!entry) return _m;
        return `data:${entry.mime};base64,${entry.data}`;
    });
}

function inlineContentLocations(html: string, parts: Part[], cssLocMap: Record<string, string> | null, jsLocMap: Record<string, string> | null) {
    let out = html;
    parts.forEach(p => {
        const loc = p.headers['content-location'];
        if (!loc) return;
        const mime = p.headers['content-type']?.split(';')[0] || 'application/octet-stream';
        const pattern = new RegExp(escapeRegex(loc), 'g');
        if (cssLocMap && mime.startsWith('text/css') && cssLocMap[loc]) {
            out = out.replace(pattern, cssLocMap[loc]);
        } else if (jsLocMap && mime.includes('javascript') && jsLocMap[loc]) {
            out = out.replace(pattern, jsLocMap[loc]);
        } else {
            const dataUri = `data:${mime};base64,${p.body.toString('base64')}`;
            out = out.replace(pattern, dataUri);
        }
    });
    return out;
}

function collectCss(html: string, parts: Part[]): string {
    const inHtml = (html.match(/<style[^>]*>[\s\S]*?<\/style>/gi) || []).join('\n');
    const fromParts = parts
        .filter(p => (p.headers['content-type'] || '').toLowerCase().startsWith('text/css'))
        .map(p => `<style data-source="${p.headers['content-location'] || ''}">\n${p.body.toString('utf8')}\n</style>`)
        .join('\n');
    return [inHtml, fromParts].filter(Boolean).join('\n');
}

function extractBody(html: string, keepCss: boolean, parts: Part[], cssLinks: string[]): string {
    const match = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const bodyContent = match ? match[1] : html;
    const css = keepCss ? collectCss(html, parts) : '';
    const links = cssLinks.join('\n');
    return `<!DOCTYPE html>\n<html>\n<head>\n${css}\n${links}\n</head>\n<body>\n${bodyContent}\n</body>\n</html>`;
}

async function main() {
    const args = process.argv.slice(2);
    const inputPathArg = args[0];
    const outputPathArg = args[1];
    const bodyOnly = args.includes('--body');
    const keepCss = args.includes('--css');
    const keepJs = args.includes('--js');
    const inlineAssets = args.includes('--inline');
    if (!inputPathArg) {
        console.error('Usage: npx ts-node scripts/mirror/convert.ts <input.mhtml> [output.html] [--body] [--css] [--js] [--inline]');
        process.exit(1);
    }
    const inputPath = path.resolve(inputPathArg);
    const outputPath = path.resolve(outputPathArg || inputPath.replace(/\.mhtml$/i, '.html'));

    const parts = parseMhtml(inputPath);
    const htmlPart = parts.find(p => (p.headers['content-type'] || '').toLowerCase().includes('text/html'));
    if (!htmlPart) throw new Error('No text/html part found in MHTML');

    const charset = parseCharset(htmlPart.headers['content-type']);
    let html: string;
    try {
        const decoder = new TextDecoder(charset);
        html = decoder.decode(htmlPart.body);
    } catch {
        html = htmlPart.body.toString('utf8');
    }

    const inlinedCid = inlineCid(html, parts);
    const cssLocMap: Record<string, string> = {};
    const cssLinks: string[] = [];
    const jsLocMap: Record<string, string> = {};
    const jsLinks: string[] = [];
    const baseName = path.basename(outputPath, path.extname(outputPath));
    const outDir = path.dirname(outputPath);
    const assetDir = path.join(outDir, `${baseName}_files`);

    // Default: export CSS/JS to external files unless --inline is provided.
    const exportCss = keepCss && !inlineAssets;
    const exportJs = keepJs && !inlineAssets;

    if (exportCss) {
        if (!fs.existsSync(assetDir)) fs.mkdirSync(assetDir, { recursive: true });
        const cssParts = parts.filter(p => (p.headers['content-type'] || '').toLowerCase().startsWith('text/css'));
        cssParts.forEach((p, idx) => {
            const fileName = `${baseName}-style-${idx + 1}.css`;
            const loc = p.headers['content-location'];
            if (loc) cssLocMap[loc] = path.join(`${baseName}_files`, fileName);
            const cssPath = path.join(assetDir, fileName);
            const charsetCss = parseCharset(p.headers['content-type']);
            let cssText: string;
            try {
                const decoder = new TextDecoder(charsetCss);
                cssText = decoder.decode(p.body);
            } catch {
                cssText = p.body.toString('utf8');
            }
            fs.writeFileSync(cssPath, cssText, 'utf8');
            cssLinks.push(`<link rel="stylesheet" href="${path.join(`${baseName}_files`, fileName)}">`);
        });
    }

    if (exportJs) {
        if (!fs.existsSync(assetDir)) fs.mkdirSync(assetDir, { recursive: true });
        const jsParts = parts.filter(p => (p.headers['content-type'] || '').toLowerCase().includes('javascript'));
        jsParts.forEach((p, idx) => {
            const fileName = `${baseName}-script-${idx + 1}.js`;
            const loc = p.headers['content-location'];
            if (loc) jsLocMap[loc] = path.join(`${baseName}_files`, fileName);
            const jsPath = path.join(assetDir, fileName);
            const charsetJs = parseCharset(p.headers['content-type']);
            let jsText: string;
            try {
                const decoder = new TextDecoder(charsetJs);
                jsText = decoder.decode(p.body);
            } catch {
                jsText = p.body.toString('utf8');
            }
            fs.writeFileSync(jsPath, jsText, 'utf8');
            jsLinks.push(`<script src="${path.join(`${baseName}_files`, fileName)}"></script>`);
        });
    }

    let fullyInlined = inlineContentLocations(inlinedCid, parts, exportCss ? cssLocMap : null, exportJs ? jsLocMap : null);
    const sanitized = bodyOnly ? extractBody(fullyInlined, keepCss, parts, [...cssLinks, ...jsLinks]) : fullyInlined;

    fs.writeFileSync(outputPath, sanitized, 'utf8');
    console.log(`Wrote ${outputPath}`);
}

main();
