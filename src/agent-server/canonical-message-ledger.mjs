import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { ensureSessionManagerDurable } from "./zyra-session-file.mjs";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_MESSAGE_CHARACTERS = 1_000_000;
const METADATA_KEY = "zyraCanonicalMessage";

export function findCanonicalMessageReceipt(sessionManager, operationIdValue) {
  const operationId = assertId(operationIdValue, "operation id");
  const entries = sessionManager?.getEntries?.() || [];
  let conversationSequence = 0;
  for (const entry of entries) {
    if (entry?.type !== "message") continue;
    const message = entry.message && typeof entry.message === "object" ? entry.message : {};
    if (["user", "assistant", "system"].includes(message.role)) conversationSequence += 1;
    const metadata = message[METADATA_KEY];
    if (!metadata || typeof metadata !== "object" || metadata.operationId !== operationId) continue;
    return receiptFromEntry(entry, metadata, conversationSequence);
  }
  return null;
}

export function appendCanonicalMessage(sessionManager, inputValue) {
  if (!sessionManager?.appendMessage || !sessionManager?.getEntries) {
    throw new Error("Canonical session manager is unavailable.");
  }
  const input = validateCanonicalAppendInput(inputValue);
  const existing = findCanonicalMessageReceipt(sessionManager, input.operationId);
  if (existing) {
    assertMatchingReceipt(existing, input);
    return existing;
  }

  for (const entry of sessionManager.getEntries()) {
    if (entry?.type !== "message") continue;
    const message = entry.message && typeof entry.message === "object" ? entry.message : {};
    const metadata = message[METADATA_KEY];
    if (message.id !== input.messageId && metadata?.idempotencyKey !== input.idempotencyKey) continue;
    if (metadata?.operationId !== input.operationId || metadata?.contentSha256 !== input.payloadSha256) {
      throw new Error("Canonical message identity is already bound to different content.");
    }
    const receipt = findCanonicalMessageReceipt(sessionManager, metadata.operationId);
    if (!receipt) throw new Error("Canonical message exists without a readable receipt.");
    return receipt;
  }

  const canonicalSequence = sessionManager.getEntries().reduce((count, entry) => {
    if (entry?.type !== "message") return count;
    return ["user", "assistant", "system"].includes(entry.message?.role) ? count + 1 : count;
  }, 0) + 1;
  const observedAt = new Date().toISOString();
  const timestamp = Date.parse(input.providerStartedAt || input.providerCompletedAt);
  const metadata = Object.freeze({
    schemaVersion: 1,
    operationId: input.operationId,
    idempotencyKey: input.idempotencyKey,
    conversationId: input.conversationId,
    canonicalMessageId: input.messageId,
    foregroundRouteId: input.routeClaim.foregroundRouteId,
    routeEpoch: input.routeClaim.routeEpoch,
    ownerClaimId: input.routeClaim.ownerClaimId,
    producer: input.producer,
    modality: input.modality,
    providerItemId: input.providerItemId,
    providerCompletedAt: input.providerCompletedAt,
    ...(input.providerStartedAt ? { providerStartedAt: input.providerStartedAt } : {}),
    attachmentIds: [...input.attachmentIds],
    contentSha256: input.payloadSha256,
    canonicalSequence,
    observedAt
  });
  const message = input.role === "user"
    ? {
        id: input.messageId,
        role: "user",
        content: [{ type: "text", text: input.text }],
        timestamp,
        [METADATA_KEY]: metadata
      }
    : {
        id: input.messageId,
        role: "assistant",
        content: [{ type: "text", text: input.text }],
        provider: "zyra-realtime",
        model: "realtime-foreground",
        stopReason: "stop",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
        },
        timestamp,
        [METADATA_KEY]: metadata
      };
  const entryId = sessionManager.appendMessage(message);
  ensureCanonicalMessageDurable(sessionManager);
  return receiptFromEntry({ id: entryId }, metadata, canonicalSequence);
}

function ensureCanonicalMessageDurable(sessionManager) {
  const sessionFile = sessionManager.getSessionFile?.();
  if (!sessionFile || sessionManager.isPersisted?.() === false) return;
  if (!ensureSessionManagerDurable(sessionManager) || !existsSync(sessionFile)) {
    throw new Error("Canonical Zyra transcript was not durably created.");
  }
}

function validateCanonicalAppendInput(value) {
  if (!value || typeof value !== "object") throw new TypeError("Canonical append input is required.");
  const input = {
    operationId: assertId(value.operationId, "operation id"),
    idempotencyKey: assertBoundedString(value.idempotencyKey, "idempotency key", 256),
    conversationId: assertId(value.conversationId, "conversation id"),
    messageId: assertId(value.messageId, "message id"),
    role: value.role === "user" ? "user" : value.role === "assistant" ? "assistant" : null,
    producer: assertBoundedString(value.producer, "producer", 64),
    modality: assertBoundedString(value.modality, "modality", 32),
    text: String(value.text || ""),
    attachmentIds: Array.isArray(value.attachmentIds)
      ? value.attachmentIds.map((entry) => assertId(entry, "attachment id")).slice(0, 32)
      : [],
    providerItemId: assertBoundedString(value.providerItemId, "provider item id", 512),
    providerCompletedAt: assertTimestamp(value.providerCompletedAt, "provider completion"),
    ...(value.providerStartedAt !== undefined ? { providerStartedAt: assertTimestamp(value.providerStartedAt, "provider start") } : {}),
    payloadSha256: String(value.payloadSha256 || ""),
    routeClaim: validateRouteClaim(value.routeClaim)
  };
  if (input.providerStartedAt && Date.parse(input.providerStartedAt) > Date.parse(input.providerCompletedAt)) {
    throw new TypeError("Provider start must not follow completion.");
  }
  if (!input.role) throw new TypeError("Canonical message role must be user or assistant.");
  if (!input.text.trim() && input.attachmentIds.length === 0) throw new TypeError("Canonical message content is empty.");
  if (input.text.length > MAX_MESSAGE_CHARACTERS) throw new TypeError("Canonical message content is too large.");
  if (!SHA256_PATTERN.test(input.payloadSha256)) throw new TypeError("Canonical payload hash is invalid.");
  return input;
}

function validateRouteClaim(value) {
  if (!value || typeof value !== "object") throw new TypeError("Foreground route claim is required.");
  const routeEpoch = Number(value.routeEpoch);
  if (!Number.isSafeInteger(routeEpoch) || routeEpoch < 1) throw new TypeError("Foreground route epoch is invalid.");
  return {
    foregroundRouteId: assertId(value.foregroundRouteId, "foreground route id"),
    routeEpoch,
    ownerClaimId: assertId(value.ownerClaimId, "foreground owner claim id")
  };
}

function receiptFromEntry(entry, metadata, fallbackSequence) {
  const canonicalSequence = Number(metadata.canonicalSequence || fallbackSequence);
  return {
    receiptId: `zyra_entry_${assertId(entry.id, "session entry id")}`,
    operationId: assertId(metadata.operationId, "operation id"),
    canonicalMessageId: assertId(metadata.canonicalMessageId, "canonical message id"),
    conversationId: assertId(metadata.conversationId, "conversation id"),
    canonicalSequence,
    foregroundRouteId: assertId(metadata.foregroundRouteId, "foreground route id"),
    routeEpoch: Number(metadata.routeEpoch),
    ownerClaimId: assertId(metadata.ownerClaimId, "foreground owner claim id"),
    contentSha256: String(metadata.contentSha256 || ""),
    observedAt: assertTimestamp(metadata.observedAt || metadata.providerCompletedAt, "receipt observation")
  };
}

function assertMatchingReceipt(receipt, input) {
  if (receipt.operationId !== input.operationId
    || receipt.canonicalMessageId !== input.messageId
    || receipt.conversationId !== input.conversationId
    || receipt.foregroundRouteId !== input.routeClaim.foregroundRouteId
    || receipt.routeEpoch !== input.routeClaim.routeEpoch
    || receipt.ownerClaimId !== input.routeClaim.ownerClaimId
    || receipt.contentSha256 !== input.payloadSha256) {
    throw new Error("Canonical operation is already bound to a different message payload.");
  }
}

function assertId(value, label) {
  const normalized = String(value || "").trim();
  if (!ID_PATTERN.test(normalized)) throw new TypeError(`${label} is invalid.`);
  return normalized;
}

function assertBoundedString(value, label, maximum) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maximum) throw new TypeError(`${label} is invalid.`);
  return normalized;
}

function assertTimestamp(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized || !Number.isFinite(Date.parse(normalized))) throw new TypeError(`${label} timestamp is invalid.`);
  return normalized;
}

export function canonicalMessagePayloadHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
