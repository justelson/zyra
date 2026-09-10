// @ts-nocheck
export const PROTOCOL_VERSION = 1
export const MAX_MESSAGE_BYTES = 512 * 1024
export const POLL_INTERVAL_MS = 350
export const FORBIDDEN_URL = /^(?:chrome|chrome-extension|edge|about|devtools):/i

export function isAllowedPageUrl(value) {
  try {
    const url = new URL(String(value || ''))
    return (url.protocol === 'http:' || url.protocol === 'https:') && !FORBIDDEN_URL.test(url.href)
  } catch {
    return false
  }
}

export function assertBoundedMessage(value) {
  const encoded = JSON.stringify(value)
  if (new TextEncoder().encode(encoded).byteLength > MAX_MESSAGE_BYTES) throw new Error('Zyra control message exceeds the extension size limit.')
  return value
}
