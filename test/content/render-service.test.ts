import { RenderScheduler } from '../test-exports';

describe('RenderScheduler guardrails', () => {
    it('logs slow renders', async () => {
        const scheduler = new RenderScheduler();
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => { });
        const times = [0, 120];
        const perfSpy = jest.spyOn(performance, 'now').mockImplementation(() => {
            return (times.length ? times.shift()! : 120);
        });
        scheduler.setRenderer(async () => {
            await new Promise(res => setTimeout(res, 1));
        });
        scheduler.request();
        await new Promise(res => setTimeout(res, 80));
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
        perfSpy.mockRestore();
    });
});
