/// <reference path="./utils.ts" />
import './constants';
import './utils';

// Provide module exports for testing while keeping the runtime namespace intact.
const exported = (globalThis as any).Utils;

export const {
    sleep,
    hashString,
    normalizeText,
    placeCaretAtEnd,
    mountFloatingEditor,
    getThreadKey,
    getMessageId,
    keyForMessage,
    markExtNode,
    closestExtNode,
    isExtensionNode,
    mutationTouchesExternal,
} = exported;
