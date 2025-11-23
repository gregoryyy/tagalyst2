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

function inlineContentLocations(html: string, parts: Part[]) {
    let out = html;
    parts.forEach(p => {
        const loc = p.headers['content-location'];
        if (!loc) return;
        const mime = p.headers['content-type']?.split(';')[0] || 'application/octet-stream';
        const dataUri = `data:${mime};base64,${p.body.toString('base64')}`;
        const pattern = new RegExp(escapeRegex(loc), 'g');
        out = out.replace(pattern, dataUri);
    });
    return out;
}

function main() {
    const [, , inputPathArg, outputPathArg] = process.argv;
    if (!inputPathArg) {
        console.error('Usage: npx ts-node test-data/convert.ts <input.mhtml> [output.html]');
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
    const fullyInlined = inlineContentLocations(inlinedCid, parts);

    fs.writeFileSync(outputPath, fullyInlined, 'utf8');
    console.log(`Wrote ${outputPath}`);
}

main();
