import { Injectable } from '@nestjs/common';
import { ApiException } from '../../common/errors/api-exception';
import { hashToken } from '../../common/security/tokens';
import { PrismaService } from '../../database/prisma.service';

export const MAX_FAILURES = 5;
export const BASE_LOCK_MINUTES = 15;
const MAX_LOCK_MINUTES = 24 * 60;

/**
 * Brute-force protection (plan 3.6): after 5 failures a key locks for 15 minutes, doubling on each
 * repeated lock. Two keys are tracked per attempt, the account and the IP+account pair, and unknown
 * accounts are tracked the same way so lockouts never reveal whether an account exists.
 */
@Injectable()
export class AuthAttemptService {
  constructor(private readonly prisma: PrismaService) {}

  private keys(realm: string, account: string, ip: string | undefined): string[] {
    const acct = account.trim().toLowerCase();
    return [
      hashToken(`${realm}|account|${acct}`),
      hashToken(`${realm}|ip-account|${ip ?? 'unknown'}|${acct}`),
    ];
  }

  /** Throws 429 while any key is locked. */
  async assertNotLocked(realm: string, account: string, ip: string | undefined): Promise<void> {
    const locked = await this.prisma.client.authAttempt.count({
      where: { keyHash: { in: this.keys(realm, account, ip) }, lockedUntil: { gt: new Date() } },
    });
    if (locked > 0) {
      throw new ApiException(429, 'TOO_MANY_ATTEMPTS', 'Too many attempts. Try again later.');
    }
  }

  /** Records a failed attempt; returns true when this failure triggered a lock. */
  async recordFailure(realm: string, account: string, ip: string | undefined): Promise<boolean> {
    let triggered = false;
    for (const key of this.keys(realm, account, ip)) {
      triggered = (await this.bump(key)) || triggered;
    }
    return triggered;
  }

  async recordSuccess(realm: string, account: string, ip: string | undefined): Promise<void> {
    await this.prisma.client.authAttempt.deleteMany({
      where: { keyHash: { in: this.keys(realm, account, ip) } },
    });
  }

  private bump(key: string): Promise<boolean> {
    return this.prisma.client.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ failures: number; lock_level: number }[]>`
        INSERT INTO auth_attempt (key_hash, failures, last_failure_at)
        VALUES (${key}, 1, now())
        ON CONFLICT (key_hash) DO UPDATE SET
          failures = CASE WHEN auth_attempt.last_failure_at < now() - interval '1 hour'
                          THEN 1 ELSE auth_attempt.failures + 1 END,
          lock_level = CASE WHEN auth_attempt.last_failure_at < now() - interval '24 hours'
                            THEN 0 ELSE auth_attempt.lock_level END,
          last_failure_at = now()
        RETURNING failures, lock_level`;
      const row = rows[0];
      if (!row || row.failures < MAX_FAILURES) return false;
      const minutes = Math.min(BASE_LOCK_MINUTES * 2 ** row.lock_level, MAX_LOCK_MINUTES);
      await tx.$executeRaw`
        UPDATE auth_attempt
        SET failures = 0, lock_level = lock_level + 1, locked_until = now() + make_interval(mins => ${minutes})
        WHERE key_hash = ${key}`;
      return true;
    });
  }
}
