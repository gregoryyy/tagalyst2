import * as fs from 'fs';
import * as path from 'path';

/**
 * Mirrors external HTTP(S) resources referenced in HTML/CSS into a local asset directory
 * and rewrites links to point to the local copies.
 */
export async function mirrorResources(html: string, baseName: string, assetDir: string): Promise<string> {
    let result = html;
    const ensureDir = () => {
        if (!fs.existsSync(assetDir)) fs.mkdirSync(assetDir, { recursive: true });
    };

    const urlMap = new Map<string, string>();
    let counter = 1;

    const normalizeExternal = (url: string) => {
        if (url.startsWith('http://') || url.startsWith('https://')) return url;
        if (url.startsWith('//')) return `https:${url}`;
        return null;
    };

    const saveBuffer = (url: string, buf: Buffer, contentType: string | null) => {
        ensureDir();
        const parsed = new URL(url);
        const extFromPath = path.extname(parsed.pathname) || '';
        const fallbackExt = contentType?.includes('javascript')
            ? '.js'
            : contentType?.includes('css')
                ? '.css'
                : contentType?.startsWith('image/')
                    ? `.${contentType.split('/')[1]}`
                    : '.bin';
        const ext = extFromPath || fallbackExt;
        const fileName = `${baseName}-external-${counter++}${ext}`;
        fs.writeFileSync(path.join(assetDir, fileName), buf);
        urlMap.set(url, `${baseName}_files/${fileName}`);
        return { fileName, ext };
    };

    const mirrorCssContent = async (cssText: string): Promise<string> => {
        let updated = cssText;
        const cssUrlRegex = /url\(["']?(https?:\/\/|\/\/)[^"')]+["']?\)/gi;
        let match: RegExpExecArray | null;
        while ((match = cssUrlRegex.exec(cssText)) !== null) {
            const raw = match[0];
            const urlMatch = raw.match(/url\(["']?([^"')]+)["']?\)/i);
            if (!urlMatch) continue;
            const normalized = normalizeExternal(urlMatch[1]);
            if (!normalized) continue;
            await addUrl(normalized);
        }
        const importRegex = /@import\s+(?:url\()?["']?(https?:\/\/|\/\/)[^"')\s]+["']?\)?/gi;
        while ((match = importRegex.exec(cssText)) !== null) {
            const urlMatch = match[0].match(/["']?([^"')\s]+)["']?/);
            if (!urlMatch) continue;
            const normalized = normalizeExternal(urlMatch[1]);
            if (!normalized) continue;
            await addUrl(normalized);
        }
        urlMap.forEach((local, remote) => {
            updated = updated.split(remote).join(local);
        });
        return updated;
    };

    const addUrl = async (url: string) => {
        if (urlMap.has(url)) return;
        const normalized = normalizeExternal(url);
        if (!normalized) return;
        try {
            const resp = await fetch(normalized);
            if (!resp.ok) return;
            const buf = Buffer.from(await resp.arrayBuffer());
            const contentType = resp.headers.get('content-type');
            const { fileName } = saveBuffer(normalized, buf, contentType);
            // If CSS, recurse to mirror its referenced assets.
            if (contentType?.includes('css')) {
                const cssText = buf.toString('utf8');
                const rewritten = await mirrorCssContent(cssText);
                fs.writeFileSync(path.join(assetDir, fileName), rewritten, 'utf8');
            }
        } catch {
            return;
        }
    };

    // src/href (includes protocol-relative)
    const attrRegex = /(src|href)=["']((?:https?:)?\/\/[^"']+)["']/gi;
    let match: RegExpExecArray | null;
    while ((match = attrRegex.exec(html)) !== null) {
        await addUrl(match[2]);
    }

    // srcset values (img/picture/source)
    const srcsetRegex = /srcset=["']([^"']+)["']/gi;
    while ((match = srcsetRegex.exec(html)) !== null) {
        const entries = match[1].split(',').map(s => s.trim().split(/\s+/)[0]).filter(Boolean);
        for (const entry of entries) {
            await addUrl(entry);
        }
    }

    // video poster
    const posterRegex = /poster=["']((?:https?:)?\/\/[^"']+)["']/gi;
    while ((match = posterRegex.exec(html)) !== null) {
        await addUrl(match[1]);
    }

    // CSS url() references in inline HTML
    const cssUrlInlineRegex = /url\(["']?((?:https?:)?\/\/[^"')]+)["']?\)/gi;
    while ((match = cssUrlInlineRegex.exec(html)) !== null) {
        await addUrl(match[1]);
    }

    // Rewrite all occurrences
    urlMap.forEach((local, remote) => {
        result = result.split(remote).join(local);
    });

    return result;
}
