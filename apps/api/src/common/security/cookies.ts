export type CookieRealm = 'staff' | 'customer';

export interface SessionCookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: '/';
  maxAge?: number;
}

/**
 * Session cookies are HttpOnly, SameSite=Lax and never carry a Domain attribute. Outside local
 * development they are `Secure` and use the `__Host-` prefix, which browsers only accept for
 * Secure, Path=/, Domain-less cookies. Staff and customer cookies have distinct names so a cookie
 * from one realm can never be mistaken for the other.
 */
export function sessionCookieName(realm: CookieRealm, secure: boolean): string {
  return `${secure ? '__Host-' : ''}matilda_${realm}`;
}

export function sessionCookieOptions(secure: boolean, maxAgeMs?: number): SessionCookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    ...(maxAgeMs === undefined ? {} : { maxAge: maxAgeMs }),
  };
}

/** Browsers only enforce `Secure` over HTTPS, so local development over http uses secure=false. */
export function useSecureCookies(nodeEnv: string): boolean {
  return nodeEnv === 'staging' || nodeEnv === 'production';
}
