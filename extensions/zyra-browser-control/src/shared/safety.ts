import { BridgeError } from './protocol';
export function pageUrl(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new BridgeError('BLOCKED_URL', 'Only ordinary HTTP and HTTPS pages can be controlled.');
  if (['chromewebstore.google.com','chrome.google.com'].includes(url.hostname) && /webstore/.test(url.href)) throw new BridgeError('BLOCKED_URL', 'Extension store pages are unavailable.');
  return url;
}
export function sameOrigin(value: string, origin: string) {
  if (pageUrl(value).origin !== origin) throw new BridgeError('ORIGIN_CHANGED', 'The page changed site. Grant access to this site from the extension.');
}
export function safeUrl(value: string) {
  try { const u = new URL(value); u.search = ''; u.hash = ''; u.username = ''; u.password = ''; return u.href; } catch { return ''; }
}
export function safeText(value: string, limit = 2000) {
  return value.replace(/\b(?:Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted]')
    .replace(/((?:password|secret|token|api[_-]?key|authorization)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]').slice(0, limit);
}
