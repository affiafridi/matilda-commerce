import { JobsService } from './jobs.service';
import { loadEnv } from '../../config/env';
import { testRedisUrl } from '../../test-support/test-db';

/** Needs Redis: `pnpm docker:redis:up`. Proves the wiring that reservation expiry (step 4.8) relies on. */
describe('background jobs (BullMQ over Redis)', () => {
  let jobs: JobsService;
  const name = `test-${Date.now()}`;

  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.REDIS_URL = testRedisUrl();
    jobs = new JobsService({ ...loadEnv(), REDIS_URL: testRedisUrl() });
  });

  afterAll(async () => {
    await jobs.queue(name).obliterate({ force: true });
    await jobs.onApplicationShutdown();
  });

  it('is enabled only when REDIS_URL is set', () => {
    expect(jobs.enabled).toBe(true);
    expect(new JobsService({ ...loadEnv(), REDIS_URL: undefined }).enabled).toBe(false);
    expect(() => new JobsService({ ...loadEnv(), REDIS_URL: undefined }).queue('x')).toThrow(
      /REDIS_URL/,
    );
  });

  it('reaches Redis', async () => {
    await expect(jobs.ping()).resolves.toBe(true);
  });

  it('runs a delayed job exactly once', async () => {
    const seen: string[] = [];
    const done = new Promise<void>((resolve) => {
      jobs.worker<{ id: string }>(name, (job) => {
        seen.push(job.data.id);
        resolve();
        return Promise.resolve();
      });
    });
    await jobs.queue(name).add('expire', { id: 'r1' }, { delay: 200, jobId: 'r1' });
    // Adding the same job id again must not queue a second run.
    await jobs.queue(name).add('expire', { id: 'r1' }, { delay: 200, jobId: 'r1' });
    await done;
    await new Promise((r) => setTimeout(r, 500));
    expect(seen).toEqual(['r1']);
  });
});
