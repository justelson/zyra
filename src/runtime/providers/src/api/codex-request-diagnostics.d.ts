export interface OpenAICodexRequestDiagnostic {
    sequence: number;
    startedAt: number;
    model: string;
    effort?: string;
    tier?: string;
    account: string;
    transport?: 'sse' | 'websocket';
    context?: 'full' | 'delta';
    fullRequestBytes: number;
    requestBytes: number;
    fullBytes: number;
    deltaBytes: number;
    websocketAttempts: number;
    sseAttempts: number;
    attempts: number;
    retries: number;
    latencyMs: number;
    firstEventMs: number | null;
    firstTextMs: number | null;
    uncachedInput: number;
    cacheRead: number;
    cacheWrite: number;
    output: number;
    cacheOutcome: 'hit' | 'miss' | 'unknown';
    localFingerprintChanges: string[];
    outcome: 'pending' | 'stop' | 'length' | 'toolUse' | 'error' | 'aborted' | 'deferred';
}
export declare function codexCircuitKey(accountId: string, endpoint: string): string;
export declare function acquireCodexWebSocketProbe(key: string): boolean;
export declare function finishCodexWebSocketProbe(key: string, outcome: 'success' | 'failure' | 'neutral'): void;
export declare function codexWebSocketRetryAt(key: string): number | undefined;
export declare function beginCodexRequestDiagnostic(sessionId: string | undefined, body: Record<string, unknown>, accountId: string, endpoint: string, serializedBytes?: number): OpenAICodexRequestDiagnostic | undefined;
export declare function recordCodexRequestAttempt(row: OpenAICodexRequestDiagnostic | undefined, transport: 'sse' | 'websocket', context: 'full' | 'delta', bytes: number): void;
export declare function finishCodexRequestDiagnostic(row: OpenAICodexRequestDiagnostic | undefined, output: {
    stopReason: OpenAICodexRequestDiagnostic['outcome'];
    usage: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
    };
}): void;
export declare function getOpenAICodexRequestDiagnostics(sessionId: string): OpenAICodexRequestDiagnostic[];
export declare function resetCodexRequestDiagnostics(sessionId?: string): void;
