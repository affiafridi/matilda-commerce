import type { Request, Response } from 'express';
import { ApiException } from '../../common/errors/api-exception';
import {
  sessionCookieName,
  sessionCookieOptions,
  useSecureCookies,
} from '../../common/security/cookies';
import { CSRF_HEADER, isOriginAllowed, isStateChangingMethod } from '../../common/security/csrf';
import type { Env } from '../../config/env';
import { type IssuedSession, type SessionInfo, csrfMatches } from './session.service';

export function staffCookieName(env: Pick<Env, 'NODE_ENV'>): string {
  return sessionCookieName('staff', useSecureCookies(env.NODE_ENV));
}

export function readStaffToken(req: Request, env: Pick<Env, 'NODE_ENV'>): string | undefined {
  const value = (req.cookies as Record<string, unknown> | undefined)?.[staffCookieName(env)];
  return typeof value === 'string' ? value : undefined;
}

export function setStaffCookie(
  res: Response,
  env: Pick<Env, 'NODE_ENV'>,
  issued: Pick<IssuedSession, 'token' | 'maxAgeMs'>,
): void {
  res.cookie(
    staffCookieName(env),
    issued.token,
    sessionCookieOptions(useSecureCookies(env.NODE_ENV), issued.maxAgeMs),
  );
}

export function clearStaffCookie(res: Response, env: Pick<Env, 'NODE_ENV'>): void {
  res.clearCookie(staffCookieName(env), sessionCookieOptions(useSecureCookies(env.NODE_ENV)));
}

/** Browser-originated mutations must come from an allowed origin (login CSRF and cross-site posts). */
export function assertAllowedOrigin(req: Request, env: Pick<Env, 'CORS_ORIGINS'>): void {
  if (!isStateChangingMethod(req.method)) return;
  if (!isOriginAllowed(req.headers.origin, req.headers.referer, env.CORS_ORIGINS)) {
    throw new ApiException(403, 'ORIGIN_NOT_ALLOWED', 'Request origin is not allowed');
  }
}

/** Cookie-authenticated mutations also need the per-session CSRF token in a header. */
export function assertCsrf(req: Request, session: SessionInfo): void {
  if (!isStateChangingMethod(req.method)) return;
  if (!csrfMatches(session, req.headers[CSRF_HEADER] as string | undefined)) {
    throw new ApiException(403, 'CSRF_FAILED', 'Missing or invalid CSRF token');
  }
}
