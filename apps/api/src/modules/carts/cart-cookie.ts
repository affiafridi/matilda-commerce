import type { Request, Response } from 'express';
import {
  sessionCookieName,
  sessionCookieOptions,
  useSecureCookies,
} from '../../common/security/cookies';
import type { Env } from '../../config/env';

/** A guest cart lives 30 days after its last visit; the cookie only carries the secret token. */
export const GUEST_CART_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const name = (env: Pick<Env, 'NODE_ENV'>): string =>
  sessionCookieName('cart', useSecureCookies(env.NODE_ENV));

export function readCartToken(req: Request, env: Pick<Env, 'NODE_ENV'>): string | undefined {
  const value = (req.cookies as Record<string, unknown> | undefined)?.[name(env)];
  return typeof value === 'string' && value.length <= 200 ? value : undefined;
}

export function setCartCookie(res: Response, env: Pick<Env, 'NODE_ENV'>, token: string): void {
  res.cookie(
    name(env),
    token,
    sessionCookieOptions(useSecureCookies(env.NODE_ENV), GUEST_CART_MAX_AGE_MS),
  );
}

export function clearCartCookie(res: Response, env: Pick<Env, 'NODE_ENV'>): void {
  res.clearCookie(name(env), sessionCookieOptions(useSecureCookies(env.NODE_ENV)));
}
