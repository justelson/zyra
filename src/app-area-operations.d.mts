export declare const APP_AREA_OPERATIONS: Readonly<Record<string, readonly string[]>>;
export declare function isAppChatRead(input: { domain?: string; operation?: string; params?: { area?: unknown } }): boolean;
export declare function isAppAreaOperation(area: string | undefined, operation: string): boolean;
