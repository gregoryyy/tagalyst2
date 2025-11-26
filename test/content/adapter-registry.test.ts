import { ThreadAdapterRegistry, ChatGptThreadAdapter } from '../test-exports';

describe('ThreadAdapterRegistry', () => {
    it('returns ChatGptThreadAdapter for chatgpt domains', () => {
        const registry = new ThreadAdapterRegistry();
        registry.register({
            name: 'chatgpt-dom',
            supports: (loc: Location) => /chatgpt\.com|chat\.openai\.com/i.test(loc.host),
            create: () => new ChatGptThreadAdapter(),
        });
        const fakeLoc = { host: 'chatgpt.com' } as Location;
        const adapter = registry.getAdapterForLocation(fakeLoc);
        expect(adapter).toBeInstanceOf(ChatGptThreadAdapter);
    });

    it('returns null when no adapter matches', () => {
        const registry = new ThreadAdapterRegistry();
        const adapter = registry.getAdapterForLocation({ host: 'example.com' } as Location);
        expect(adapter).toBeNull();
    });
});
