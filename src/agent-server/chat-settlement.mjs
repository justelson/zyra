export const AUTO_SETTLE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

export function currentChatSettlementChoice(chat, metadata = {}) {
  const choice = metadata.settlement;
  return choice && choice.messageCount === Math.max(0, Number(chat.messageCount) || 0) ? choice : null;
}

export function automaticSettlementDeadline(chat, metadata = {}) {
  if (currentChatSettlementChoice(chat, metadata) || !(Number(chat.messageCount) > 0)) return null;
  const activityAt = Date.parse(chat.modifiedAt || chat.createdAt);
  return Number.isFinite(activityAt) ? activityAt + AUTO_SETTLE_AFTER_MS : null;
}

/** Catalog-owned choice follows conversation content, never a client's history page. */
export function projectChatSettlement(chat, metadata, now = Date.now()) {
  const choice = currentChatSettlementChoice(chat, metadata);
  if (choice) return choice.state === 'settled';
  const deadline = automaticSettlementDeadline(chat, metadata);
  return deadline !== null && now >= deadline;
}
