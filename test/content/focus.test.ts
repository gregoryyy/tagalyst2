import { describe, expect, it, beforeEach } from '@jest/globals';
import { FocusService, FOCUS_MODES } from '../test-exports';

class FakeConfigService {
    constructor(
        private searchEnabled = true,
        private tagsEnabled = true,
    ) { }
    isSearchEnabled() { return this.searchEnabled; }
    areTagsEnabled() { return this.tagsEnabled; }
    setSearchEnabled(v: boolean) { this.searchEnabled = v; }
    setTagsEnabled(v: boolean) { this.tagsEnabled = v; }
}

describe('FocusService', () => {
    let config: FakeConfigService;
    let focus: FocusService;

    beforeEach(() => {
        config = new FakeConfigService();
        focus = new FocusService(config as any);
        focus.reset();
    });

    it('defaults to stars mode', () => {
        focus.syncMode();
        expect(focus.getMode()).toBe(FOCUS_MODES.STARS);
    });

    it('selecting tags switches to tags mode when enabled', () => {
        focus.toggleTag('foo');
        focus.syncMode();
        expect(focus.getMode()).toBe(FOCUS_MODES.TAGS);
    });

    it('search takes precedence over tags when enabled', () => {
        focus.toggleTag('foo');
        focus.setSearchQuery('bar');
        focus.syncMode();
        expect(focus.getMode()).toBe(FOCUS_MODES.SEARCH);
    });

    it('disabled features fall back to stars', () => {
        config.setTagsEnabled(false);
        focus.toggleTag('foo');
        focus.syncMode();
        expect(focus.getMode()).toBe(FOCUS_MODES.STARS);

        focus.reset();
        config.setSearchEnabled(false);
        focus.setSearchQuery('hi');
        focus.syncMode();
        expect(focus.getMode()).toBe(FOCUS_MODES.STARS);
    });

    it('matches selected tags when in tags mode', () => {
        const el = document.createElement('div');
        focus.toggleTag('foo');
        focus.syncMode();
        const meta: any = { value: { tags: ['foo'] } };
        expect(focus.isMessageFocused(meta, el)).toBe(true);
        const meta2: any = { value: { tags: ['bar'] } };
        expect(focus.isMessageFocused(meta2, el)).toBe(false);
    });

    it('matches search query against text, tags, and notes', () => {
        const el = document.createElement('div');
        el.innerText = 'Hello world';
        focus.setSearchQuery('world');
        focus.syncMode();
        const meta: any = { value: { tags: [], note: '' }, adapter: null };
        expect(focus.isMessageFocused(meta, el)).toBe(true);

        const tagMeta: any = { value: { tags: ['greeting'], note: '' }, adapter: null };
        focus.setSearchQuery('greet');
        focus.syncMode();
        expect(focus.isMessageFocused(tagMeta, el)).toBe(true);

        const noteMeta: any = { value: { tags: [], note: 'Reminder: hello' }, adapter: null };
        focus.setSearchQuery('reminder');
        focus.syncMode();
        expect(focus.isMessageFocused(noteMeta, el)).toBe(true);
    });
});
