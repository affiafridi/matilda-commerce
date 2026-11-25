import { loadEnv } from './env';

describe('loadEnv', () => {
  it('applies defaults', () => {
    const env = loadEnv({});
    expect(env.PORT).toBe(4000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000', 'http://localhost:3001']);
    expect(env.SWAGGER_ENABLED).toBe(true);
  });

  it('disables swagger by default in production', () => {
    expect(loadEnv({ NODE_ENV: 'production' }).SWAGGER_ENABLED).toBe(false);
    expect(loadEnv({ NODE_ENV: 'production', SWAGGER_ENABLED: 'true' }).SWAGGER_ENABLED).toBe(true);
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
});
