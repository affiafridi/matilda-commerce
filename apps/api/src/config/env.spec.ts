import { randomBytes } from 'node:crypto';
import { loadEnv } from './env';

const key = (): string => randomBytes(32).toString('base64');

describe('loadEnv', () => {
  it('applies defaults', () => {
    const env = loadEnv({});
    expect(env.PORT).toBe(4000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000', 'http://localhost:3001']);
    expect(env.SWAGGER_ENABLED).toBe(true);
  });

  it('allows skipping two-factor only in development, and never by default', () => {
    expect(loadEnv({}).DEV_SKIP_MFA).toBe(false);
    expect(loadEnv({ DEV_SKIP_MFA: 'true' }).DEV_SKIP_MFA).toBe(true);
    for (const NODE_ENV of ['test', 'staging', 'production']) {
      expect(() => loadEnv({ NODE_ENV, DEV_SKIP_MFA: 'true' })).toThrow(/DEV_SKIP_MFA/);
    }
  });

  it('disables swagger by default in production', () => {
    const base = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://x',
      APP_ENCRYPTION_KEYS: `1:${key()}`,
      APP_ENCRYPTION_ACTIVE_KEY: '1',
      TRUSTED_PROXY_SECRET: 'x'.repeat(32),
      PASSWORD_PEPPER: 'p'.repeat(32),
    };
    expect(loadEnv(base).SWAGGER_ENABLED).toBe(false);
    expect(loadEnv({ ...base, SWAGGER_ENABLED: 'true' }).SWAGGER_ENABLED).toBe(true);
  });

  it('parses and trims CORS origins', () => {
    expect(loadEnv({ CORS_ORIGINS: ' https://a.test , https://b.test ' }).CORS_ORIGINS).toEqual([
      'https://a.test',
      'https://b.test',
    ]);
  });

  it('fails fast on invalid values', () => {
    expect(() => loadEnv({ PORT: 'not-a-port' })).toThrow(/Invalid environment configuration/);
  });

  it('requires secrets and database in production and staging', () => {
    for (const NODE_ENV of ['production', 'staging']) {
      expect(() => loadEnv({ NODE_ENV })).toThrow(/DATABASE_URL.*Required/s);
    }
  });

  it('validates the encryption key ring', () => {
    expect(() => loadEnv({ APP_ENCRYPTION_KEYS: '1:short' })).toThrow(/32-byte/);
    expect(() =>
      loadEnv({ APP_ENCRYPTION_KEYS: `1:${key()}`, APP_ENCRYPTION_ACTIVE_KEY: '2' }),
    ).toThrow(/Active key version/);
  });
});
