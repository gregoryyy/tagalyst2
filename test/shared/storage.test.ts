import { describe, expect, it, beforeEach } from '@jest/globals';
import { tagalystStorage } from '../../src/shared/storage';
import chromeMock from '../mocks/chrome';

// Ensure the global chrome uses the same mock instance
(global as any).chrome = chromeMock;

describe('tagalystStorage', () => {
    beforeEach(async () => {
        await tagalystStorage.clear();
    });

    it('reads empty when no keys exist', async () => {
        const result = await tagalystStorage.read(['missing']);
        expect(result).toEqual({ missing: undefined });
    });

    it('writes and reads back records', async () => {
        await tagalystStorage.write({ a: 1, b: { c: 2 } });
        const result = await tagalystStorage.read(['a', 'b']);
        expect(result).toEqual({ a: 1, b: { c: 2 } });
    });

    it('no-ops on empty write', async () => {
        const before = await tagalystStorage.readAll();
        await tagalystStorage.write({});
        const after = await tagalystStorage.readAll();
        expect(after).toEqual(before);
    });

    it('clears all data', async () => {
        await tagalystStorage.write({ x: 1, y: 2 });
        await tagalystStorage.clear();
        const result = await tagalystStorage.readAll();
        expect(result).toEqual({});
    });

    it('readAll returns all keys', async () => {
        await tagalystStorage.write({ k1: 'v1', k2: 2 });
        const all = await tagalystStorage.readAll();
        expect(all).toEqual({ k1: 'v1', k2: 2 });
    });

    it('read handles null keys as readAll', async () => {
        await tagalystStorage.write({ key: 'val' });
        const result = await tagalystStorage.read(null as any);
        expect(result).toEqual({ key: 'val' });
    });
});
