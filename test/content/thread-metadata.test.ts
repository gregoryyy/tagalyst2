import { describe, expect, it, beforeEach } from '@jest/globals';
import { ThreadMetadataService, deriveThreadId } from '../test-exports';

class StubStorage {
    public written: Record<string, any> = {};
    public store: Record<string, any> = {};
    async read(keys: string[]) {
        const res: Record<string, any> = {};
        keys.forEach(k => { res[k] = this.store[k]; });
        return res;
    }
    async write(record: Record<string, any>) {
        Object.assign(this.store, record);
        Object.assign(this.written, record);
    }
}

describe('ThreadMetadataService', () => {
    let storage: StubStorage;
    let service: any;

    beforeEach(() => {
        storage = new StubStorage();
        service = new ThreadMetadataService(storage as any);
    });

    it('reads stored metadata', async () => {
        storage.store['__tagalyst_thread__abc'] = { name: 'My Thread' };
        const meta = await service.read('abc');
        expect(meta).toEqual({ name: 'My Thread' });
    });

    it('writes metadata under prefixed key', async () => {
        await service.write('abc', { name: 'Thread', tags: ['x'] });
        expect(storage.store['__tagalyst_thread__abc']).toEqual({ name: 'Thread', tags: ['x'] });
    });

    it('updates size preserving other fields', async () => {
        storage.store['__tagalyst_thread__abc'] = { name: 'Thread' };
        await service.updateSize('abc', 42);
        expect(storage.store['__tagalyst_thread__abc']).toEqual({ name: 'Thread', size: 42 });
    });

    it('updates length preserving other fields', async () => {
        storage.store['__tagalyst_thread__abc'] = { name: 'Thread', size: 10 };
        await service.updateLength('abc', 80);
        expect(storage.store['__tagalyst_thread__abc']).toEqual({ name: 'Thread', size: 10, length: 80 });
    });
});

describe('deriveThreadId', () => {
    const originalPath = Object.getOwnPropertyDescriptor(window, 'location');

    const setPathname = (pathname: string) => {
        Object.defineProperty(window, 'location', { value: { pathname } as any, configurable: true });
    };

    const restoreLocation = () => {
        if (originalPath) {
            Object.defineProperty(window, 'location', originalPath);
        }
    };

    afterAll(() => restoreLocation());

    it('extracts id from /c/ path', () => {
        setPathname('/g/project/c/12345');
        expect(deriveThreadId()).toBe('12345');
    });

    it('falls back to Utils.getThreadKey when no match', () => {
        setPathname('/project/overview');
        (global as any).Utils = {
            getThreadKey: () => 'fallback-id',
        };
        expect(deriveThreadId()).toBe('fallback-id');
    });
});
