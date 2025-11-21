import { describe, it, expect } from '@jest/globals';
import path from 'path';
import fs from 'fs';

let puppeteer: any;
let executablePath: string | undefined;
try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    puppeteer = require('puppeteer') || require('puppeteer-core');
} catch {
    // no-op: will skip
}
executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;

const htmlFixture = fs.readFileSync(path.join(__dirname, '../../options/options.html'), 'utf-8');

const shouldRun = puppeteer && (puppeteer.product === 'chrome' ? true : !!executablePath);

(shouldRun ? describe : describe.skip)('Puppeteer smoke', () => {
    it('loads the options page fixture', async () => {
        const browser = await puppeteer.launch({
            headless: 'new' as any,
            executablePath,
        });
        const page = await browser.newPage();
        await page.setContent(htmlFixture);
        const title = await page.$eval('h1', (el: Element) => el.textContent || '');
        expect(title).toContain('Tagalyst');
        await browser.close();
    });
});
