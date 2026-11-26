import { redisConnection } from './jobs.service';

describe('redisConnection', () => {
  it('reads host, port, credentials and database from the URL', () => {
    expect(redisConnection('redis://user:p%40ss@cache.internal:6380/2')).toMatchObject({
      host: 'cache.internal',
      port: 6380,
      username: 'user',
      password: 'p@ss',
      db: 2,
      maxRetriesPerRequest: null,
    });
  });

  it('defaults the port, adds TLS for rediss and rejects other schemes', () => {
    expect(redisConnection('redis://localhost')).toMatchObject({ host: 'localhost', port: 6379 });
    expect(redisConnection('rediss://h:1')).toHaveProperty('tls');
    expect(() => redisConnection('http://localhost')).toThrow(/redis:\/\//);
  });
});
