const REDACTED = '[REDACTED]';
const SENSITIVE_KEY =
  /pass(word|wd)?|secret|token|totp|otp|recovery|hash|authorization|cookie|api[-_]?key|private[-_]?key|credential|cvv|card[-_]?number|\bpan\b/i;
const EMAIL = /^([^@\s])[^@\s]*@([^@\s]+\.[^@\s]+)$/;

const MAX_DEPTH = 6;
const MAX_ARRAY = 50;
const MAX_STRING = 500;

/** `jane.doe@example.com` -> `j***@example.com`: enough for support, never the full address. */
export function maskEmail(value: string): string {
  return value.replace(EMAIL, '$1***@$2');
}

/**
 * Produces a JSON-safe copy of `value` for the audit log: secrets are replaced by a marker (by key
 * name), email addresses are masked, and size is bounded. Never mutates the input.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const masked = maskEmail(value);
    return masked.length > MAX_STRING ? `${masked.slice(0, MAX_STRING)}…` : masked;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return '[TRUNCATED]';
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((v) => redact(v, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(v, depth + 1);
    }
    return out;
  }
  return null;
}
