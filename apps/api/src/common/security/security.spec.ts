import { sessionCookieName, sessionCookieOptions, useSecureCookies } from './cookies';
import { csrfTokensMatch, isOriginAllowed, isStateChangingMethod } from './csrf';
import { generateToken, hashToken, safeEqual } from './tokens';

describe('tokens', () => {
  it('generates unique url-safe tokens and hashes deterministically', () => {
    const a = generateToken();
    expect(a).toMatch(/^[\w-]{43}$/);
    expect(generateToken()).not.toBe(a);
    expect(hashToken(a)).toBe(hashToken(a));
    expect(hashToken(a)).not.toBe(a);
    expect(hashToken(a)).toHaveLength(64);
  });

  it('compares in a length-safe way', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('cookies', () => {
  it('uses distinct names per realm and the __Host- prefix when secure', () => {
    expect(sessionCookieName('staff', true)).toBe('__Host-matilda_staff');
    expect(sessionCookieName('customer', false)).toBe('matilda_customer');
    expect(sessionCookieName('staff', true)).not.toBe(sessionCookieName('customer', true));
  });

  it('is HttpOnly, SameSite=Lax, path=/ and without a Domain attribute', () => {
    const opts = sessionCookieOptions(true, 1000);
    expect(opts).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 1000,
    });
    expect('domain' in opts).toBe(false);
  });

  it('is secure only for staging and production', () => {
    expect(useSecureCookies('production')).toBe(true);
    expect(useSecureCookies('staging')).toBe(true);
    expect(useSecureCookies('development')).toBe(false);
  });
});

describe('csrf', () => {
  const allowed = ['https://admin.example.test'];

  it('only treats unsafe methods as state-changing', () => {
    expect(isStateChangingMethod('POST')).toBe(true);
    expect(isStateChangingMethod('get')).toBe(false);
  });

  it('accepts only allow-listed origins, falling back to referer', () => {
    expect(isOriginAllowed('https://admin.example.test', undefined, allowed)).toBe(true);
    expect(isOriginAllowed('https://evil.test', undefined, allowed)).toBe(false);
    expect(isOriginAllowed(undefined, 'https://admin.example.test/path?x=1', allowed)).toBe(true);
    expect(isOriginAllowed(undefined, 'not a url', allowed)).toBe(false);
    expect(isOriginAllowed(undefined, undefined, allowed)).toBe(false);
  });

  it('matches double-submit tokens strictly', () => {
    expect(csrfTokensMatch('t', 't')).toBe(true);
    expect(csrfTokensMatch('t', 'u')).toBe(false);
    expect(csrfTokensMatch(undefined, 't')).toBe(false);
  });
});
