/// <reference path="./top-panel.ts" />
import '../utils';
import './top-panel';
import '../constants';

// Provide module export for testing.
export const TopPanelController = (globalThis as any).TopPanelController as typeof TopPanelController;
