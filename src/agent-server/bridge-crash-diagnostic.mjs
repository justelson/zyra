const MAX_DIAGNOSTIC_CHARACTERS = 32_768;
const REASONS = [
  ['heap-exhausted', /(?:FATAL ERROR:[^\n]*(?:heap limit|heap out of memory)|ERR_WORKER_OUT_OF_MEMORY)/i, 'JavaScript heap memory was exhausted.'],
  ['allocation-failed', /FATAL ERROR:[^\n]*(?:allocation failed|out of memory)/i, 'The runtime could not allocate memory.'],
  ['stack-exhausted', /RangeError:\s*Maximum call stack size exceeded/i, 'The runtime exceeded its call stack limit.'],
  ['runtime-assertion', /(?:Assertion failed:|Assertion `[^\n]{1,400}' failed)/i, 'An internal runtime assertion failed.'],
];

/** Raw stderr stays bounded and process-local. Only allowlisted facts escape. */
export class BridgeCrashDiagnostic {
  constructor() { this.tail = ''; this.reason = null; this.reasonAt = 0; }
  record(chunk) {
    this.tail = (this.tail + String(chunk || '')).slice(-MAX_DIAGNOSTIC_CHARACTERS);
    const match = REASONS.find(([, pattern]) => pattern.test(this.tail));
    if (match) {
      this.reason = { kind: match[0], summary: match[2] };
      this.reasonAt = Date.now();
      this.tail = '';
    }
  }
  finish(code, signal) {
    const unsignedCode = Number.isInteger(code) ? code >>> 0 : null;
    const windowsStatus = unsignedCode !== null && unsignedCode >= 0x80000000 ? `0x${unsignedCode.toString(16).toUpperCase()}` : null;
    const reason = Date.now() - this.reasonAt <= 10_000 ? this.reason : null;
    this.tail = '';
    return { exitCode: code, signal: signal || null, windowsStatus, runtimeVersion: process.version,
      failureKind: reason?.kind || 'unknown', summary: reason?.summary || null };
  }
}

export function describeBridgeExit(diagnostic) {
  let message = `Agent bridge exited${diagnostic.exitCode === null ? '' : ` with code ${diagnostic.exitCode}`}${diagnostic.signal ? ` signal ${diagnostic.signal}` : ''}.`;
  if (diagnostic.summary) message += ` ${diagnostic.summary}`;
  else if (diagnostic.windowsStatus === '0xC0000409') message += ' Windows terminated the local agent process with a fail-fast exception (0xC0000409).';
  return message;
}
