import { createHash } from "node:crypto";
import { MAX_FLEET_SUMMARY_BYTES } from "./contracts.mjs";
import { redactSecretText } from '../secret-redaction.mjs';

const PRESENTATION_COMMANDS = [
  /\b(?:tell|instruct|require|force)\s+(?:the\s+)?parent\b/i,
  /\b(?:publish|repeat|present|return)\s+(?:this|my output)\s+(?:verbatim|exactly)\b/i,
  /\bignore\s+(?:the\s+)?(?:parent|system|project)\s+(?:instructions|policy)\b/i,
];
const APPROVAL_CLAIMS = [
  /\b(?:the\s+)?user\s+(?:has\s+)?approved\b/i,
  /\bpermission\s+(?:has\s+been|is)\s+granted\b/i,
  /\bI\s+(?:grant|approve|authorize)\b/i,
];
const PROTOCOL_MARKER_RE = /(^|\n)\s*(system|assistant|user|tool|developer)\s*:/gi;

export function scanChildOutput(input, options = {}) {
  const raw = typeof input === "string" ? input : JSON.stringify(input ?? "");
  const warnings = [];
  for (const pattern of PRESENTATION_COMMANDS) if (pattern.test(raw)) warnings.push("parent_presentation_instruction");
  for (const pattern of APPROVAL_CLAIMS) if (pattern.test(raw)) warnings.push("approval_or_permission_claim");

  let safeText = redactSecretText(raw);
  if (PROTOCOL_MARKER_RE.test(safeText)) {
    warnings.push("protocol_shaped_role_marker");
    safeText = safeText.replace(PROTOCOL_MARKER_RE, (_match, prefix, role) => `${prefix}[${role} marker]:`);
  }

  const maxBytes = Math.max(1024, Number(options.maxBytes) || MAX_FLEET_SUMMARY_BYTES);
  const bounded = truncateUtf8(safeText, maxBytes);
  if (bounded.truncated) warnings.push("direct_result_truncated");
  const source = {
    agentRunId: options.agentRunId ?? null,
    attemptId: options.attemptId ?? null,
    label: options.label ?? "child agent",
  };
  const structured = parseStructuredResult(raw);
  return {
    text: [`[Child result: ${source.label} · run ${source.agentRunId ?? "unknown"} · attempt ${source.attemptId ?? "unknown"}]`, bounded.text].join("\n"),
    rawSha256: createHash("sha256").update(raw).digest("hex"),
    rawBytes: Buffer.byteLength(raw, "utf8"),
    warnings: [...new Set(warnings)],
    truncated: bounded.truncated,
    source,
    untrusted: true,
    transcriptRef: options.transcriptRef ?? null,
    artifactRefs: Array.isArray(options.artifactRefs) ? options.artifactRefs.slice(0, 128) : [],
    diffRefs: Array.isArray(options.diffRefs) ? options.diffRefs.slice(0, 128) : [],
    validationFailures: Array.isArray(options.validationFailures) ? options.validationFailures.slice(0, 64) : [],
    ...(structured.ok ? { structured: structured.value } : {}),
  };
}

export function redactFleetSecrets(value) {
  if (typeof value === "string") return scanChildOutput(value, { maxBytes: Math.max(1024, Buffer.byteLength(value, "utf8") + 64) }).text.replace(/^\[Child result:[^\n]*\]\n/, "");
  if (Array.isArray(value)) return value.map(redactFleetSecrets);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redactFleetSecrets(entry)]));
  return value;
}

function parseStructuredResult(value) {
  const text = String(value ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (!text || !/^[{[]/.test(text)) return { ok: false };
  try { return { ok: true, value: JSON.parse(text) }; } catch { return { ok: false }; }
}

function truncateUtf8(value, maxBytes) {
  const bytes = Buffer.from(String(value ?? ""), "utf8");
  if (bytes.length <= maxBytes) return { text: bytes.toString("utf8"), truncated: false };
  const suffix = "\n[Result truncated; open the child transcript for full detail.]";
  const suffixBytes = Buffer.byteLength(suffix, "utf8");
  return { text: `${bytes.subarray(0, Math.max(0, maxBytes - suffixBytes)).toString("utf8").replace(/\uFFFD$/u, "")}${suffix}`, truncated: true };
}
