// Pure classification: no filesystem, SDK, provider or UI imports. Keep policy
// tests here so individual command regressions do not boot an agent runtime.
const CRITICAL_TOOL_NAME_PATTERN = /(?:^|[._-])(delete|remove|publish|deploy|release|purchase|payment|billing|account|security|credential|password|secret|upload|install|message|email|send)(?:[._-]|$)/;
const DEFINITE_CRITICAL_COMMAND_PATTERNS = [
  /\bgit\s+(?:push|reset\s+--hard|clean\s+-[^\r\n]*f|rebase|filter-(?:repo|branch)|branch\s+-D)\b/i,
  /\b(?:npm|pnpm|yarn|bun)\s+publish\b/i,
  /\b(?:gh\s+release|docker\s+push|terraform\s+(?:apply|destroy)|kubectl\s+(?:apply|delete)|vercel\s+(?:deploy|--prod)|railway\s+up)\b/i,
  /\b(?:rm\s+-[^\r\n]*r[^\r\n]*f|remove-item\b[^\r\n]*(?:-recurse[^\r\n]*-force|-force[^\r\n]*-recurse)|rmdir\s+\/s|del\s+\/s|format\b(?!-(?:list|table|wide|custom|hex)(?![\w.-]))|diskpart\b)/i,
  /\b(?:drop\s+(?:database|schema|table)|truncate\s+table)\b/i,
  /\b(?:winget|choco|scoop|apt(?:-get)?|brew)\s+(?:install|upgrade|uninstall|remove)\b/i,
  /\b(?:set-executionpolicy|reg(?:\.exe)?\s+(?:add|delete)|sc(?:\.exe)?\s+(?:create|delete|config)|net\s+user)\b/i,
];
const AMBIGUOUS_CRITICAL_WORD_PATTERN = /\b(?:login|logout|password|credential|secret|token|billing|payment|purchase|production|prod|deploy|publish|release)\b/i;
const text = value => typeof value === 'string' ? value.trim() : '';

export function isDefinitelyCriticalZyraToolPermission(request = {}) {
  const toolName = String(request.toolName || '').trim().toLowerCase();
  if (CRITICAL_TOOL_NAME_PATTERN.test(toolName)) return true;
  const command = [request.command, request.detail].map(text).filter(Boolean).join('\n');
  return Boolean(command && DEFINITE_CRITICAL_COMMAND_PATTERNS.some(pattern => pattern.test(command)));
}

export function isPotentiallyCriticalZyraToolPermission(request = {}) {
  if (request.outsideProject || isDefinitelyCriticalZyraToolPermission(request)) return true;
  const command = [request.command, request.detail].map(text).filter(Boolean).join('\n');
  return Boolean(command && AMBIGUOUS_CRITICAL_WORD_PATTERN.test(command));
}
