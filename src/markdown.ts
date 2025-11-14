type ListFrame = { type: 'ul' | 'ol'; index: number };

interface MarkdownContext {
    listStack: ListFrame[];
    blockquoteDepth: number;
    insideListItem: boolean;
}

class MarkdownSerializer {
    toMarkdown(root: HTMLElement) {
        const context: MarkdownContext = {
            listStack: [],
            blockquoteDepth: 0,
            insideListItem: false,
        };
        const content = this.renderChildren(root, context);
        return this.normalizeOutput(content);
    }

    private renderChildren(parent: Node, ctx: MarkdownContext): string {
        const out: string[] = [];
        parent.childNodes.forEach(child => {
            const chunk = this.renderNode(child, ctx);
            if (chunk) out.push(chunk);
        });
        return out.join('');
    }

    private renderNode(node: Node, ctx: MarkdownContext): string {
        if (node.nodeType === Node.TEXT_NODE) {
            return this.renderText(node.textContent || '', ctx);
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return '';
        const el = node as HTMLElement;
        const katex = this.tryRenderKatex(el, ctx);
        if (katex !== null) return katex;
        const tag = el.tagName.toLowerCase();
        switch (tag) {
            case 'p':
            case 'div':
            case 'section':
            case 'article':
            case 'main':
                return this.wrapBlock(this.renderChildren(el, { ...ctx, insideListItem: ctx.insideListItem }), ctx);
            case 'br':
                return '\n';
            case 'strong':
            case 'b':
                return `**${this.renderChildren(el, ctx)}**`;
            case 'em':
            case 'i':
                return `*${this.renderChildren(el, ctx)}*`;
            case 'u':
                return `__${this.renderChildren(el, ctx)}__`;
            case 's':
            case 'del':
                return `~~${this.renderChildren(el, ctx)}~~`;
            case 'code':
                return this.renderInlineCode(el);
            case 'pre':
                return this.renderCodeBlock(el, ctx);
            case 'ul':
                return this.renderList(el, ctx, 'ul');
            case 'ol':
                return this.renderList(el, ctx, 'ol');
            case 'li':
                return this.renderListItem(el, ctx);
            case 'blockquote':
                return this.renderBlockquote(el, ctx);
            case 'a':
                return this.renderLink(el, ctx);
            case 'img':
                return this.renderImage(el);
            case 'hr':
                return this.wrapBlock('---', ctx);
            case 'h1':
            case 'h2':
            case 'h3':
            case 'h4':
            case 'h5':
            case 'h6': {
                const level = parseInt(tag.charAt(1), 10) || 1;
                const text = this.renderChildren(el, { ...ctx, insideListItem: false }).trim();
                if (!text) return '';
                return this.wrapBlock(`${'#'.repeat(Math.min(level, 6))} ${text}`, ctx);
            }
            case 'table':
                return this.renderTable(el, ctx);
            case 'thead':
            case 'tbody':
            case 'tfoot':
            case 'tr':
            case 'th':
            case 'td':
            case 'span':
            case 'label':
            case 'kbd':
            case 'details':
            case 'summary':
            case 'figure':
            case 'figcaption':
                return this.renderChildren(el, ctx);
            default:
                if (el.childNodes.length) {
                    return this.renderChildren(el, ctx);
                }
                return '';
        }
    }

    private tryRenderKatex(el: HTMLElement, ctx: MarkdownContext) {
        if (!el.classList) return null;
        const classes = Array.from(el.classList);
        if (!classes.includes('katex')) return null;
        if (classes.some(cls => cls === 'katex-html' || cls === 'katex-mathml' || cls === 'katex-annotation')) {
            return null;
        }
        const tex = this.extractKatexSource(el);
        if (!tex) return null;
        const display = !!el.closest('.katex-display');
        return this.formatKatex(tex, display, ctx);
    }

    private renderText(text: string, _ctx: MarkdownContext) {
        if (!text) return '';
        return text
            .replace(/\s+/g, ' ')
            .replace(/([\\`*_{}\[\]])/g, '\\$1');
    }

    private wrapBlock(content: string, ctx: MarkdownContext) {
        const body = this.normalizeBlock(content);
        if (!body) return '';
        const pad = ctx.insideListItem ? '\n' : '\n\n';
        return `${pad}${body}${pad}`;
    }

    private normalizeBlock(text: string) {
        return text.replace(/\n{3,}/g, '\n\n').trim();
    }

    private renderInlineCode(el: HTMLElement) {
        const text = el.textContent || '';
        const safe = text.replace(/`/g, '\\`');
        return `\`${safe}\``;
    }

    private renderCodeBlock(el: HTMLElement, ctx: MarkdownContext) {
        const codeEl = el.querySelector('code');
        const lang = codeEl ? this.extractLanguage(codeEl.className || '') : '';
        const content = codeEl ? codeEl.textContent || '' : el.textContent || '';
        const body = content.replace(/^\n+/, '').replace(/\s+$/, '');
        const fence = lang ? `\`\`\`${lang}` : '```';
        const pad = ctx.insideListItem ? '\n' : '\n\n';
        return `${pad}${fence}\n${body}\n\`\`\`\n\n`;
    }

    private extractLanguage(className: string) {
        const match = className.match(/language-([\w-]+)/i) || className.match(/lang-([\w-]+)/i);
        return match ? match[1] : '';
    }

    private renderList(el: HTMLElement, ctx: MarkdownContext, type: 'ul' | 'ol') {
        const depth = ctx.listStack.length;
        const indent = '  '.repeat(depth);
        const items: string[] = [];
        let order = 1;
        el.childNodes.forEach(child => {
            if (child.nodeType !== Node.ELEMENT_NODE) return;
            if ((child as HTMLElement).tagName.toLowerCase() !== 'li') return;
            const marker = type === 'ul' ? '-' : `${order}.`;
            const nextCtx: MarkdownContext = {
                ...ctx,
                listStack: [...ctx.listStack, { type, index: order }],
                insideListItem: true,
            };
            const body = this.renderListItem(child as HTMLElement, nextCtx);
            if (!body) {
                if (type === 'ol') order++;
                return;
            }
            const formatted = body
                .split('\n')
                .map((line, i) => (i === 0 ? line : `${indent}  ${line}`))
                .join('\n');
            items.push(`${indent}${marker} ${formatted}`);
            if (type === 'ol') order++;
        });
        if (!items.length) return '';
        const pad = ctx.insideListItem ? '\n' : '\n\n';
        return `${pad}${items.join('\n')}\n`;
    }

    private renderListItem(el: HTMLElement, ctx: MarkdownContext) {
        const inner = this.renderChildren(el, ctx);
        return inner.replace(/^\n+|\n+$/g, '').replace(/\n{3,}/g, '\n\n');
    }

    private renderBlockquote(el: HTMLElement, ctx: MarkdownContext) {
        const depth = ctx.blockquoteDepth + 1;
        const inner = this.renderChildren(el, { ...ctx, blockquoteDepth: depth });
        const body = inner.replace(/^\n+|\n+$/g, '').replace(/\n{3,}/g, '\n\n');
        if (!body) return '';
        const prefix = Array(depth).fill('>').join('');
        const lines = body.split('\n').map(line => `${prefix} ${line}`.trimEnd());
        const pad = ctx.insideListItem ? '\n' : '\n\n';
        return `${pad}${lines.join('\n')}\n`;
    }

    private renderLink(el: HTMLElement, ctx: MarkdownContext) {
        const href = el.getAttribute('href') || '';
        const text = this.renderChildren(el, ctx).trim() || href;
        if (!href) return text;
        const title = el.getAttribute('title');
        const suffix = title ? ` "${title}"` : '';
        return `[${text}](${href}${suffix})`;
    }

    private renderImage(el: HTMLElement) {
        const src = el.getAttribute('src') || '';
        if (!src) return '';
        const alt = el.getAttribute('alt') || '';
        return `![${alt}](${src})`;
    }

    private renderTable(el: HTMLElement, ctx: MarkdownContext) {
        const rows = Array.from(el.querySelectorAll('tr')).map(row =>
            Array.from(row.children).map(cell => this.renderChildren(cell, ctx).replace(/\n+/g, ' ').trim())
        );
        if (!rows.length) return '';
        const header = rows[0];
        const divider = header.map(() => '---');
        const lines = [
            `| ${header.join(' | ')} |`,
            `| ${divider.join(' | ')} |`,
            ...rows.slice(1).map(cols => `| ${cols.join(' | ')} |`),
        ];
        const pad = ctx.insideListItem ? '\n' : '\n\n';
        return `${pad}${lines.join('\n')}\n`;
    }

    private normalizeOutput(text: string) {
        return text.replace(/\n{3,}/g, '\n\n').trim();
    }

    private extractKatexSource(el: HTMLElement) {
        const annotation = el.querySelector<HTMLElement>('annotation[encoding="application/x-tex"], .katex-annotation');
        const attrCandidates = [
            'data-lexical-text',
            'data-source',
            'data-katex',
        ];
        const sources = [
            annotation?.textContent || '',
            ...attrCandidates.map(attr => el.getAttribute(attr) || ''),
        ];
        const text = sources.map(s => s.trim()).find(Boolean);
        if (text) return text;
        const math = el.querySelector('math');
        return math?.textContent?.trim() || '';
    }

    private formatKatex(tex: string, display: boolean, ctx: MarkdownContext) {
        const trimmed = tex.trim();
        if (!trimmed) return '';
        if (display) {
            const pad = ctx.insideListItem ? '\n' : '\n\n';
            return `${pad}$$\n${trimmed}\n$$\n`;
        }
        const inlineTex = trimmed.replace(/\s+/g, ' ');
        return `$${inlineTex}$`;
    }
}
