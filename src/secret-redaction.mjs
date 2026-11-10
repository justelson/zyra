const SECRET_PATTERNS = [
  [/\b(?:sk|sess|key)-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED_SECRET]'],
  [/\bgh[opusr]_[A-Za-z0-9]{20,}\b/g, '[REDACTED_SECRET]'],
  [/\b(code|state)=([^&\s]{8,})/gi, (_match, name) => `${name}=[REDACTED_SECRET]`],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}\b/g, '[REDACTED_SECRET]'],
];

/** Shared text-only pass. No child-envelope parsing, hashing or protocol rewriting. */
export function redactSecretText(value) {
  let result = String(value);
  for (const [pattern, replacement] of SECRET_PATTERNS) result = result.replace(pattern, replacement);
  return result;
}
