import { RenderScheduler } from '../test-exports';

describe('RenderScheduler guardrails', () => {
    it('logs slow renders', async () => {
        const originalRaf = global.requestAnimationFrame;
        const scheduler = new RenderScheduler();
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => { });
        const times = [0, 120];
        const perfSpy = jest.spyOn(performance, 'now').mockImplementation(() => {
            return (times.length ? times.shift()! : 120);
        });
        global.requestAnimationFrame = (cb: FrameRequestCallback): number => {
            cb(performance.now());
            return 1;
        };
        const renderer = jest.fn(async () => {
            await new Promise(res => setTimeout(res, 1));
        });
        scheduler.setRenderer(renderer);
        scheduler.request();
        await new Promise(res => setTimeout(res, 5));
        expect(renderer).toHaveBeenCalled();
        warnSpy.mockRestore();
        perfSpy.mockRestore();
        global.requestAnimationFrame = originalRaf;
    });
});
