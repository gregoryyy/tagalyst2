// Lightweight declarations to satisfy isolated test compilation; they merge with real globals when present.
declare global {
    interface ConfigService { [key: string]: any; }
    interface MessageMeta { value?: any; adapter?: any; pairIndex?: number | null; key?: string | null; }
    interface MessageMetaRegistry {
        clear(): void;
        forEach(cb: (meta: MessageMeta, el: HTMLElement) => void): void;
        delete(el: HTMLElement): void;
        get(el: HTMLElement): MessageMeta | null;
        resolveAdapter(el: HTMLElement): any;
    }
    interface MessageAdapter { element: HTMLElement; getText(): string; }
    interface PageControls { focusPrev?: HTMLButtonElement | null; focusNext?: HTMLButtonElement | null; collapseNonFocus?: HTMLButtonElement | null; expandFocus?: HTMLButtonElement | null; exportFocus?: HTMLButtonElement | null; }
    type MessageValue = any;
    interface TagalystPair { query: HTMLElement | null; response: HTMLElement | null; }
    const DomMessageAdapter: any;
}

/// <reference path="./focus.ts" />
import '../utils';
import './focus';

// Provide module exports for testing.
const exported = (globalThis as any);

export const FocusService = exported.FocusService as typeof FocusService;
export const FocusController = exported.FocusController as typeof FocusController;
export const FOCUS_MODES = exported.FOCUS_MODES as typeof FOCUS_MODES;
export const focusMarkerColors = exported.focusMarkerColors as typeof focusMarkerColors;
