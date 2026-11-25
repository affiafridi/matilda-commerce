import { normalizeHost, requestHost } from './host';

const SECRET = 's'.repeat(32);

describe('normalizeHost', () => {
  it('lowercases and strips port and trailing dot', () => {
    expect(normalizeHost('MatildaFlower.com:443')).toBe('matildaflower.com');
    expect(normalizeHost('flower.localhost.')).toBe('flower.localhost');
  });

  it('rejects non-hostnames', () => {
    for (const bad of [undefined, '', 'a b', 'x/y', 'a@b.com', '[::1]', '-bad.com']) {
      expect(normalizeHost(bad)).toBeNull();
    }
  });
});

describe('requestHost', () => {
  it('uses Host when no proxy proof is presented', () => {
    expect(requestHost({ host: 'api.test:4000' }, SECRET)).toBe('api.test');
  });

  it('ignores a forged X-Forwarded-Host', () => {
    const headers = { host: 'api.test', 'x-forwarded-host': 'matildacake.com' };
    expect(requestHost(headers, SECRET)).toBe('api.test');
    expect(requestHost({ ...headers, 'x-matilda-proxy-secret': 'wrong' }, SECRET)).toBe('api.test');
    expect(requestHost({ ...headers, 'x-matilda-proxy-secret': SECRET }, undefined)).toBe(
      'api.test',
    );
  });

  it('honours X-Forwarded-Host with the proxy secret (first value only)', () => {
    const headers = {
      host: 'api.test',
      'x-forwarded-host': 'matildacake.com, other.com',
      'x-matilda-proxy-secret': SECRET,
    };
    expect(requestHost(headers, SECRET)).toBe('matildacake.com');
  });
});
