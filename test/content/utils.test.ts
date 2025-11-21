import { describe, expect, it } from '@jest/globals';
import {
    hashString,
    normalizeText,
    keyForMessage,
    markExtNode,
    isExtensionNode,
    mutationTouchesExternal,
} from '../test-exports';

describe('Utils', () => {
    it('hashString is deterministic and differs for different input', () => {
        const a = hashString('abc');
        const b = hashString('abc');
        const c = hashString('abcd');
        expect(a).toBe(b);
        expect(a).not.toBe(c);
    });

    it('normalizeText collapses whitespace and strips zero-width chars', () => {
        const input = '  hello \n world\u200B \t ';
        expect(normalizeText(input)).toBe('hello world');
    });

    it('keyForMessage uses data-message-id when present', () => {
        const el = document.createElement('div');
        el.setAttribute('data-message-id', 'mid-123');
        expect(keyForMessage(el)).toBe('mid-123');
    });

    it('keyForMessage falls back to text + index hash', () => {
        const parent = document.createElement('div');
        const a = document.createElement('div');
        a.innerText = 'first';
        const b = document.createElement('div');
        b.innerText = 'second';
        parent.append(a, b);
        const keyA = keyForMessage(a);
        const keyA2 = keyForMessage(a);
        const keyB = keyForMessage(b);
        expect(keyA).toBe(keyA2);
        expect(keyA).not.toBe(keyB);
    });

    it('markExtNode adds the extension attribute and isExtensionNode detects it', () => {
        const el = document.createElement('div');
        expect(isExtensionNode(el)).toBe(false);
        markExtNode(el);
        expect(el.getAttribute('data-ext-owned')).toBe('1');
        expect(isExtensionNode(el)).toBe(true);
    });

    it('mutationTouchesExternal respects extension-owned nodes', () => {
        const extNode = document.createElement('div');
        markExtNode(extNode);
        const hostNode = document.createElement('div');
        const recordExtOnly = {
            target: extNode,
            addedNodes: [extNode],
            removedNodes: [],
        } as unknown as MutationRecord;
        const recordHost = {
            target: hostNode,
            addedNodes: [],
            removedNodes: [],
        } as unknown as MutationRecord;
        expect(mutationTouchesExternal(recordExtOnly)).toBe(false);
        expect(mutationTouchesExternal(recordHost)).toBe(true);
    });
});
