const BACKSLASH = String.fromCharCode(92);

/** True when the string holds an ASCII control character (code < 32 or DEL). */
function hasControlCharacter(value: string): boolean {
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

/**
 * Post-sign-in destinations come from a query string, so they are untrusted. Only same-origin,
 * absolute paths are allowed (no scheme, no protocol-relative `//`, no backslash tricks), and
 * never the authentication screens themselves.
 */
export function safeNext(candidate: string | null | undefined, fallback = '/'): string {
  if (!candidate || candidate.length > 512) return fallback;
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return fallback;
  if (candidate.includes(BACKSLASH) || hasControlCharacter(candidate)) return fallback;
  const path = candidate.split(/[?#]/)[0] ?? '';
  if (path === '/sign-in' || path.startsWith('/sign-in/') || path === '/accept-invite') {
    return fallback;
  }
  return candidate;
}
