import * as fs from 'fs';
import * as path from 'path';

/**
 * Mirrors all external HTTP(S) resources referenced in the HTML (src/href/url())
 * into a local asset directory and rewrites links to point to the local copies.
 */
export async function mirrorResources(html: string, baseName: string, assetDir: string): Promise<string> {
    let result = html;
    const ensureDir = () => {
        if (!fs.existsSync(assetDir)) fs.mkdirSync(assetDir, { recursive: true });
    };

    const urlMap = new Map<string, string>();
    let counter = 1;

    const addUrl = async (url: string) => {
        if (urlMap.has(url)) return;
        try {
            const resp = await fetch(url);
            if (!resp.ok) return;
            const buf = Buffer.from(await resp.arrayBuffer());
            ensureDir();
            // Try to keep a meaningful extension.
            const parsed = new URL(url);
            const extFromPath = path.extname(parsed.pathname) || '';
            const contentType = resp.headers.get('content-type') || '';
            const fallbackExt = contentType.includes('javascript')
                ? '.js'
                : contentType.includes('css')
                    ? '.css'
                    : contentType.startsWith('image/')
                        ? `.${contentType.split('/')[1]}`
                        : '.bin';
            const ext = extFromPath || fallbackExt;
            const fileName = `${baseName}-external-${counter++}${ext}`;
            fs.writeFileSync(path.join(assetDir, fileName), buf);
            urlMap.set(url, `${baseName}_files/${fileName}`);
        } catch {
            return;
        }
    };

    // Find src/href http(s) references
    const attrRegex = /(src|href)=["'](https?:\/\/[^"']+)["']/gi;
    let match: RegExpExecArray | null;
    while ((match = attrRegex.exec(html)) !== null) {
        const url = match[2];
        await addUrl(url);
    }

    // Find CSS url() references
    const cssUrlRegex = /url\(["']?(https?:\/\/[^"')]+)["']?\)/gi;
    while ((match = cssUrlRegex.exec(html)) !== null) {
        const url = match[1];
        await addUrl(url);
    }

    // Rewrite all occurrences
    urlMap.forEach((local, remote) => {
        result = result.split(remote).join(local);
    });

    return result;
}
