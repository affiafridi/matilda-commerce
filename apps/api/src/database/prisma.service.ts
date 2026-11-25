import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import type { ReadinessCheck } from '@matilda/types';
import { APP_ENV, type Env } from '../config/env';
import { PrismaClient } from '../generated/prisma/client';

const PING_TIMEOUT_MS = 2000;

/**
 * The only place that talks to PostgreSQL (docs/ARCHITECTURE.md). The connection is lazy so the
 * API can boot without a database in Phase 1; readiness reports the real state.
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  private instance: PrismaClient | undefined;

  constructor(@Inject(APP_ENV) private readonly env: Env) {}

  get client(): PrismaClient {
    if (!this.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not configured');
    }
    this.instance ??= new PrismaClient({
      adapter: new PrismaPg({ connectionString: this.env.DATABASE_URL }),
    });
    return this.instance;
  }

  async ping(): Promise<ReadinessCheck> {
    if (!this.env.DATABASE_URL) {
      return { status: 'down', detail: 'DATABASE_URL is not configured' };
    }
    const started = Date.now();
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.client.$queryRaw`SELECT 1`,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), PING_TIMEOUT_MS);
        }),
      ]);
      return { status: 'ok', latencyMs: Date.now() - started };
    } catch (err) {
      // Never leak connection strings or driver details to the response.
      const detail = err instanceof Error && err.message === 'timeout' ? 'timeout' : 'unreachable';
      return { status: 'down', latencyMs: Date.now() - started, detail };
    } finally {
      clearTimeout(timer);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.instance?.$disconnect();
  }
}
