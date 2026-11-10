import type { ServerOptions } from 'node:https';
export interface MobileHostClient {
  readonly connectionStatus?: Record<string, unknown>;
  connect(): Promise<unknown>;
  request(method: string, params?: Record<string, unknown>, options?: Record<string, unknown>): Promise<any>;
  attach(params: Record<string, unknown>): Promise<any>;
  detach(id: string): Promise<any>;
  on(name: string, listener: (...args: any[]) => void): unknown;
  close(): void;
}
export interface Device { id: string; name: string; createdAt: number; lastPairedAt?: number; hiddenProjects?: string[] }
export interface Gateway {
  devices: DeviceStore;
  connectedDeviceIds(): string[];
  listen(host?: string, port?: number): Promise<{ address: string; port: number }>;
  setAccess(id: string, access: { hiddenProjects: string[] }): void;
  revoke(id: string): void;
  close(): Promise<void>;
}
export class DeviceStore {
  constructor(directory: string);
  list(): Device[];
  setAccess(id: string, access: { hiddenProjects: string[] }): void;
  revoke(id: string): void;
}
export function createGateway(options: { tls: ServerOptions; directory: string; projects: string[]; allProjects?: boolean; hiddenProjects?: string[]; name?: string;
  runtimeStatus?: () => unknown;
  timingSummary?: (properties: Record<string, unknown>) => void;
  captures?: { reference(id: string): unknown; list(input: { offset?: number; limit?: number }): unknown; get(id: string): Promise<unknown>; chunk(ref: any, offset: number): Promise<unknown>; delete(id: string): unknown };
  searchChats?: (input: { query: string; limit: number }) => Promise<{ matches: any[]; indexingOlderChats: boolean }>;
  searchContext?: (input: { session: string; threadId: string; messageId: string }) => Promise<unknown>;
  projectPresentation?: (project: string) => Promise<unknown>;
  regenerateTitle?: (id: string) => Promise<{ title: string }>;
  accountLimits?: () => Promise<unknown>;
  review?: { index(canonicalChatId: string): Promise<any>; turn(canonicalChatId: string, turnId: string): Promise<any>; details?(canonicalChatId: string): Promise<any>; metadata?(ids: string[]): Promise<any> };
  pluginFactory?: (device: Device, changed: () => void) => { supportsMachineScope?: boolean; dispatch(method: string, params: any, chat: any, manageMachine: boolean): Promise<any>; close(): void };
  voiceFactory?: (device: Device, receive: (event: Record<string, unknown>) => void) => { dispatch(method: string, params: any, chat: any): Promise<any>; close(): Promise<void> };
  clientFactory: (device: Device) => MobileHostClient | Promise<MobileHostClient>; fleet?: { read(session: string, type: string, payload: Record<string, unknown>, live?: any): Promise<any> }; prepareChat?: (id: string) => Promise<boolean>; resolveScope?: (id: string) => Promise<unknown>; terminalFactory?: (device: Device, receive: (event: Record<string, unknown>) => void) => { supportsSplit?: boolean; dispatch(method: string, params: any, chat: any, roots: any[]): Promise<any>; close(): void } }): Gateway;
export function hostTls(directory: string): Promise<ServerOptions & { fingerprint: string }>;
export function prepareHostProcessIdentity(): Promise<void>;
export function pairingDisplay(gateway: Gateway, tls: { fingerprint: string }, url: string, name: string): Promise<{ link: string; image: string; expiresAt: number }>;
