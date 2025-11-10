const { hashString, normalizeText } = require('../content/util.js');

describe('hashString', () => {
    it('produces deterministic output for same input', () => {
        const value = hashString('Tagalyst');
        expect(hashString('Tagalyst')).toBe(value);
    });

    it('differentiates between similar strings', () => {
        expect(hashString('tagalyst')).not.toBe(hashString('Tagalyst'));
    });
});

describe('normalizeText', () => {
    it('collapses whitespace and trims ends', () => {
        expect(normalizeText('  hello   world  ')).toBe('hello world');
    });

    it('removes zero-width characters', () => {
        const input = `foo\u200bbar`;
        expect(normalizeText(input)).toBe('foobar');
    });
});
