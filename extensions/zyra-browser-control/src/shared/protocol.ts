import { z } from 'zod';
import type { ThemePreference, ZyraAppearance } from './appearance';

export const VERSION = '1.0.0';
export const PROTOCOL = 1;
export const DEFAULT_PORT = 14203;
export const MAX_BYTES = 6 * 1024 * 1024;
export const REQUEST_TIMEOUT = 25_000;
export const tabIdSchema = z.number().int().positive();
const ref = z.string().regex(/^[a-f0-9-]+:\d+$/);
const tab = { tabId: tabIdSchema };
const element = { ...tab, ref };
export const operationSchemas = {
  tabs: z.object({}).strict(),
  snapshot: z.object({ ...tab, maxElements: z.number().int().min(1).max(1000).default(400) }).strict(),
  screenshot: z.object({ ...tab }).strict(),
  click: z.object({ ...element, button: z.enum(['left', 'right']).default('left'), count: z.number().int().min(1).max(2).default(1) }).strict(),
  hover: z.object(element).strict(),
  fill: z.object({ ...element, text: z.string().max(50_000) }).strict(),
  type: z.object({ ...element, text: z.string().max(50_000) }).strict(),
  press: z.object({ ...element, key: z.enum(['Enter','Tab','Escape','Backspace','Delete','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown','Space']), modifiers: z.array(z.enum(['Alt','Control','Meta','Shift'])).max(4).default([]) }).strict(),
  select: z.object({ ...element, values: z.array(z.string().max(2000)).min(1).max(100) }).strict(),
  scroll: z.object({ ...tab, ref: ref.optional(), x: z.number().min(-10000).max(10000).default(0), y: z.number().min(-10000).max(10000) }).strict(),
  navigate: z.object({ ...tab, url: z.string().url().max(8192) }).strict(),
  reload: z.object(tab).strict(),
  back: z.object(tab).strict(),
  forward: z.object(tab).strict(),
  wait: z.object({ ...tab, text: z.string().min(1).max(500), timeoutMs: z.number().int().min(100).max(20000).default(10000) }).strict(),
  focus: z.object(tab).strict(),
  diagnostics: z.object(tab).strict(),
  release: z.object({ tabId: tabIdSchema.optional() }).strict(),
} as const;
export type Method = keyof typeof operationSchemas;
export type Operation = { [K in Method]: { method: K; params: z.infer<typeof operationSchemas[K]> } }[Method];
export function parseOperation(value: unknown): Operation {
  const head = z.object({ method: z.string(), params: z.unknown() }).strict().parse(value);
  if (!Object.hasOwn(operationSchemas, head.method)) throw new BridgeError('UNKNOWN_METHOD', 'Unsupported browser operation.');
  return { method: head.method, params: operationSchemas[head.method as Method].parse(head.params) } as Operation;
}
export class BridgeError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'BridgeError'; }
}
export function errorInfo(error: unknown) {
  if (error instanceof z.ZodError) return { code: 'INVALID_ARGUMENT', message: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') };
  return { code: error instanceof BridgeError ? error.code : 'OPERATION_FAILED', message: error instanceof Error ? error.message : 'Unknown operation failure.' };
}
export interface Grant { tabId: number; title: string; url: string; origin: string; grantedAt: number; mode: 'read' | 'control'; }
export interface Activity { id: string; method: string; tabId?: number; startedAt: number; durationMs: number; outcome: 'ok' | 'error'; code?: string; }
export interface ExtensionState { connected: boolean; connecting: boolean; port: number; grants: Grant[]; activity: Activity[]; lastError: string | null; theme: ThemePreference; zyraAppearance: ZyraAppearance; tabsLayout: 'list' | 'grid'; }
export interface RequestMessage { type: 'request'; id: string; deadline: number; operation: Operation; }
export const readMethods = new Set<Method>(['tabs','snapshot','screenshot','wait','diagnostics']);
