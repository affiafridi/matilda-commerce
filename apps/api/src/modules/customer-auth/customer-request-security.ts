import type { Request, Response } from 'express';
import { ApiException } from '../../common/errors/api-exception';
import {
  sessionCookieName,
  sessionCookieOptions,
  useSecureCookies,
} from '../../common/security/cookies';
import { CSRF_HEADER, isStateChangingMethod } from '../../common/security/csrf';
import type { Env } from '../../config/env';
import { normalizeHost } from '../tenancy/host';
import type { ResolvedTenant, TenantResolver } from '../tenancy/tenant-resolver.service';
import {
  type CustomerSessionInfo,
  type IssuedCustomerSession,
  customerCsrfMatches,
} from './customer-session.service';

export type RequestWithTenant = Request & {
  tenant?: ResolvedTenant;
  customerSession?: CustomerSessionInfo;
};

export const customerCookieName = (env: Pick<Env, 'NODE_ENV'>): string =>
  sessionCookieName('customer', useSecureCookies(env.NODE_ENV));

export function readCustomerToken(req: Request, env: Pick<Env, 'NODE_ENV'>): string | undefined {
  const value = (req.cookies as Record<string, unknown> | undefined)?.[customerCookieName(env)];
  return typeof value === 'string' ? value : undefined;
}

export function setCustomerCookie(
  res: Response,
  env: Pick<Env, 'NODE_ENV'>,
  issued: Pick<IssuedCustomerSession, 'token' | 'maxAgeMs'>,
): void {
  res.cookie(
    customerCookieName(env),
    issued.token,
    sessionCookieOptions(useSecureCookies(env.NODE_ENV), issued.maxAgeMs),
  );
}

export function clearCustomerCookie(res: Response, env: Pick<Env, 'NODE_ENV'>): void {
  res.clearCookie(customerCookieName(env), sessionCookieOptions(useSecureCookies(env.NODE_ENV)));
}

export function requireTenant(req: RequestWithTenant): ResolvedTenant {
  if (!req.tenant) throw new ApiException(404, 'TENANT_NOT_FOUND', 'Unknown storefront');
  return req.tenant;
}

/**
 * Browser mutations must come from a page of the SAME brand: the Origin (or Referer) host has to
 * resolve to the brand that this request resolved to. This blocks login CSRF and cross-brand posts.
 */
export async function assertSameBrandOrigin(
  req: RequestWithTenant,
  resolver: TenantResolver,
): Promise<void> {
  if (!isStateChangingMethod(req.method)) return;
  const raw = req.headers.origin ?? req.headers.referer;
  let host: string | null = null;
  try {
    host = raw ? normalizeHost(new URL(raw).hostname) : null;
  } catch {
    host = null;
  }
  const origin = host ? await resolver.resolve(host) : null;
  if (!origin || origin.brand.id !== requireTenant(req).brand.id) {
    throw new ApiException(403, 'ORIGIN_NOT_ALLOWED', 'Request origin is not allowed');
  }
}

export function assertCustomerCsrf(req: Request, session: CustomerSessionInfo): void {
  if (!isStateChangingMethod(req.method)) return;
  if (!customerCsrfMatches(session, req.headers[CSRF_HEADER] as string | undefined)) {
    throw new ApiException(403, 'CSRF_FAILED', 'Missing or invalid CSRF token');
  }
}
