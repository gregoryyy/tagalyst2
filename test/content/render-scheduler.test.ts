import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import { RenderScheduler } from '../test-exports';

describe('RenderScheduler', () => {
    let scheduler: any;
    let rafSpy: ReturnType<typeof jest.spyOn>;
    let cancelSpy: ReturnType<typeof jest.spyOn>;
    let rafHandlers: Array<FrameRequestCallback>;
    let rafId = 1;

    beforeEach(() => {
        jest.restoreAllMocks();
        jest.clearAllMocks();
        scheduler = new RenderScheduler();
        rafHandlers = [];
        rafId = 1;
        rafSpy = jest.spyOn(global, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
            rafHandlers.push(cb);
            return rafId++;
        });
        cancelSpy = jest.spyOn(global, 'cancelAnimationFrame').mockImplementation(() => undefined as any);
    });

    it('sets renderer via setRenderer and runs it on request', async () => {
        const fn = jest.fn<() => Promise<void>>().mockResolvedValue(undefined as void);
        scheduler.setRenderer(fn as unknown as any);
        scheduler.request();
        expect(rafSpy).toHaveBeenCalledTimes(1);
        // flush RAF
        const last = rafHandlers[rafHandlers.length - 1];
        last?.(performance.now());
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('coalesces multiple requests into one frame', () => {
        const fn = jest.fn<() => Promise<void>>().mockResolvedValue(undefined as void);
        scheduler.setRenderer(fn as unknown as any);
        scheduler.request();
        scheduler.request();
        expect(rafSpy).toHaveBeenCalledTimes(2); // second cancels first then reschedules
        expect(cancelSpy).toHaveBeenCalledTimes(1);
        scheduler.request();
        expect(cancelSpy).toHaveBeenCalledTimes(2);
        expect(rafSpy).toHaveBeenCalledTimes(3); // third call cancels second, schedules third
        const last = rafHandlers[rafHandlers.length - 1];
        last?.(performance.now());
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('allows swapping renderer during request', () => {
        const fn1 = jest.fn<() => Promise<void>>().mockResolvedValue(undefined as void);
        const fn2 = jest.fn<() => Promise<void>>().mockResolvedValue(undefined as void);
        scheduler.setRenderer(fn1 as unknown as any);
        scheduler.request(fn2 as unknown as any);
        rafHandlers.forEach(cb => cb(performance.now()));
        expect(fn1).not.toHaveBeenCalled();
        expect(fn2).toHaveBeenCalledTimes(1);
    });

    it('no-ops when no renderer is set', () => {
        scheduler = new RenderScheduler();
        scheduler.request();
        expect(rafSpy).toHaveBeenCalledTimes(0);
    });

    it('only logs slow renders when warnings are enabled', async () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined as any);
        const perfSpy = jest.spyOn(performance, 'now');
        const values = [0, 120]; // start, finish
        perfSpy.mockImplementation(() => (values.length ? values.shift()! : 200));

        const fn = jest.fn<() => void>().mockImplementation(() => undefined as void);
        scheduler.setRenderer(fn as unknown as any);
        scheduler.request();
        rafHandlers.forEach(cb => cb(performance.now()));
        expect(warnSpy).not.toHaveBeenCalled();

        warnSpy.mockClear();
        perfSpy.mockRestore();
        const timedValues = [0, 120];
        jest.spyOn(performance, 'now').mockImplementation(() => (timedValues.length ? timedValues.shift()! : 200));
        scheduler.setWarningsEnabled(true);
        scheduler.request();
        rafHandlers.slice(-1).forEach(cb => cb(performance.now()));
        expect(warnSpy).toHaveBeenCalledTimes(1);
    });
});
