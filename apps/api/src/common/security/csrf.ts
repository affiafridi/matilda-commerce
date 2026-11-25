import { generateToken, safeEqual } from './tokens';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const CSRF_HEADER = 'x-csrf-token';

export function isStateChangingMethod(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

/**
 * Cookie-authenticated mutations must come from an allowed origin. `Origin` is checked first;
 * `Referer` is the fallback for clients that omit it. Missing both is rejected.
 */
export function isOriginAllowed(
  origin: string | undefined,
  referer: string | undefined,
  allowedOrigins: readonly string[],
): boolean {
  const candidate = origin ?? (referer ? safeOrigin(referer) : undefined);
  return candidate !== undefined && allowedOrigins.includes(candidate);
}

function safeOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

export function generateCsrfToken(): string {
  return generateToken(24);
}

/** Double-submit check: header value must equal the value bound to the session. */
export function csrfTokensMatch(headerValue: string | undefined, expected: string): boolean {
  return headerValue !== undefined && safeEqual(headerValue, expected);
}
