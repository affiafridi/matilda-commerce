import type { IncomingHttpHeaders } from 'node:http';
import { safeEqual } from '../../common/security/tokens';

export const PROXY_SECRET_HEADER = 'x-matilda-proxy-secret';
export const FORWARDED_HOST_HEADER = 'x-forwarded-host';

const HOSTNAME = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

/** Lowercases, drops the port and any trailing dot; returns null for anything that is not a hostname. */
export function normalizeHost(raw: string | undefined): string | null {
  if (!raw) return null;
  const host = raw.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  return host.length <= 253 && HOSTNAME.test(host) ? host : null;
}

function first(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v?.split(',')[0]?.trim();
}

/**
 * The hostname the visitor used. `X-Forwarded-Host` is honoured only when the caller proves it is
 * our own Next.js server via the shared proxy secret; otherwise the connection's `Host` is used.
 * Brand headers or query parameters are never read: the brand always comes from the host.
 */
export function requestHost(
  headers: IncomingHttpHeaders,
  proxySecret: string | undefined,
): string | null {
  const forwarded = first(headers[FORWARDED_HOST_HEADER]);
  const presented = first(headers[PROXY_SECRET_HEADER]);
  if (forwarded && proxySecret && presented && safeEqual(presented, proxySecret)) {
    return normalizeHost(forwarded);
  }
  return normalizeHost(first(headers.host));
}
