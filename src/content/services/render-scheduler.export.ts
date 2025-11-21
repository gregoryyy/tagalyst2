/// <reference path="./render-scheduler.ts" />
import './render-scheduler';

// Provide a module export for testing.
const exported = (globalThis as any).RenderScheduler || (globalThis as any).default || (globalThis as any);

export const RenderScheduler = exported.RenderScheduler || (globalThis as any).RenderScheduler || (globalThis as any);
