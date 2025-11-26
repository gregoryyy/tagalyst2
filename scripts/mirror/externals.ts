import * as fs from 'fs';
import * as path from 'path';

/**
 * Mirrors external HTTP(S) resources referenced in HTML/CSS into a local asset directory
 * and rewrites links to point to the local copies.
 *
 * Coverage:
 * - src/href pointing to http(s) or protocol-relative URLs.
 * - srcset entries (img/picture/source), video poster.
 * - CSS url(...) and @import references.
 * - Recursive mirroring for CSS assets referenced inside mirrored stylesheets.
 *
 * Notes:
 * - Relative or data: URLs are left untouched.
 * - Non-HTTP(S) protocols are ignored.
 */
export async function mirrorResources(
    html: string,
    baseName: string,
    assetDir: string,
    assetUrlBase = `${baseName}_files`
): Promise<{ html: string; map: Record<string, string> }> {
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
        const fileName = `asset-${counter++}${ext}`;
        fs.writeFileSync(path.join(assetDir, fileName), buf);
        const targetPath = `${assetUrlBase}/${fileName}`;
        urlMap.set(url, targetPath);
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

    return { html: result, map: Object.fromEntries(urlMap) };
}

async function main() {
    const [inputHtml, baseArg, assetDirArg] = process.argv.slice(2);
    if (!inputHtml) {
        // eslint-disable-next-line no-console
        console.error('Usage: npx ts-node scripts/mirror/externals.ts <input.html> [baseName] [assetDir]');
        process.exit(1);
    }
    const htmlPath = path.resolve(inputHtml);
    const baseName = baseArg || path.basename(htmlPath, path.extname(htmlPath));
    const assetDir = assetDirArg
        ? path.resolve(assetDirArg)
        : path.join(path.dirname(htmlPath), `${baseName}_externals`);
    const html = fs.readFileSync(htmlPath, 'utf8');
    const { html: rewritten, map } = await mirrorResources(html, baseName, assetDir, `${baseName}_externals`);
    const backupPath = `${htmlPath}.bak`;
    fs.copyFileSync(htmlPath, backupPath);
    fs.writeFileSync(htmlPath, rewritten, 'utf8');
    const mapPath = path.join(path.dirname(htmlPath), `${baseName}_externals_map.json`);
    fs.writeFileSync(mapPath, JSON.stringify({ count: Object.keys(map).length, map }, null, 2), 'utf8');
    // eslint-disable-next-line no-console
    console.log(
        `Mirrored externals for ${htmlPath} into ${assetDir} (map: ${mapPath}, count: ${Object.keys(map).length}, backup: ${backupPath})`
    );
}

if (require.main === module) {
    main().catch(err => {
        // eslint-disable-next-line no-console
        console.error(err);
        process.exit(1);
    });
}
