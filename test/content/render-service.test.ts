import { RenderScheduler } from '../test-exports';

describe('RenderScheduler guardrails', () => {
    it('logs slow renders', async () => {
        const scheduler = new RenderScheduler();
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => { });
        scheduler.setRenderer(async () => {
            await new Promise(res => setTimeout(res, 60));
        });
        scheduler.request();
        await new Promise(res => setTimeout(res, 80));
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });
});
