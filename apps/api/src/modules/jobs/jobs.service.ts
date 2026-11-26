import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { type ConnectionOptions, Queue, Worker, type Processor } from 'bullmq';
import { APP_ENV, type Env } from '../../config/env';

/** Turns `redis://[user:pass@]host:port[/db]` into BullMQ connection options. */
export function redisConnection(url: string): ConnectionOptions {
  const u = new URL(url);
  if (u.protocol !== 'redis:' && u.protocol !== 'rediss:') {
    throw new Error('REDIS_URL must start with redis:// or rediss://');
  }
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    ...(u.username && { username: decodeURIComponent(u.username) }),
    ...(u.password && { password: decodeURIComponent(u.password) }),
    ...(u.pathname.length > 1 && { db: Number(u.pathname.slice(1)) }),
    ...(u.protocol === 'rediss:' && { tls: {} }),
    // BullMQ workers require this; queues are unaffected.
    maxRetriesPerRequest: null,
  };
}

/**
 * Background jobs (Phase 4, D4-15): BullMQ over Redis, first used for reservation expiry in step 4.8.
 * Nothing connects until a queue or worker is requested, so the API still starts without Redis;
 * features that need jobs check `enabled` and fail with a clear message instead of silently skipping.
 */
@Injectable()
export class JobsService implements OnApplicationShutdown {
  private readonly queues = new Map<string, Queue>();
  private readonly workers: Worker[] = [];

  constructor(@Inject(APP_ENV) private readonly env: Env) {}

  get enabled(): boolean {
    return !!this.env.REDIS_URL;
  }

  private connection(): ConnectionOptions {
    if (!this.env.REDIS_URL) throw new Error('Background jobs need REDIS_URL to be set.');
    return redisConnection(this.env.REDIS_URL);
  }

  queue(name: string): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: this.connection() });
      this.queues.set(name, q);
    }
    return q;
  }

  worker<T = unknown, R = unknown>(name: string, processor: Processor<T, R>): Worker<T, R> {
    const w = new Worker<T, R>(name, processor, { connection: this.connection() });
    this.workers.push(w as Worker);
    return w;
  }

  /** Reachability check for health and tests: a real round trip to Redis. */
  async ping(): Promise<boolean> {
    try {
      const q = this.queue('matilda-ping');
      await q.waitUntilReady();
      await q.getJobCounts();
      return true;
    } catch {
      return false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()));
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}
