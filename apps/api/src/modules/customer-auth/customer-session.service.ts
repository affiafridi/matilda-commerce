import { Injectable } from '@nestjs/common';
import { generateToken, hashToken, safeEqual } from '../../common/security/tokens';
import { PrismaService } from '../../database/prisma.service';
import { withScope } from '../../database/scope';
import type { Prisma } from '../../generated/prisma/client';

const DAY = 24 * 60 * 60 * 1000;
export const CUSTOMER_SESSION_POLICY = {
  idleMs: 30 * DAY,
  absoluteMs: 90 * DAY,
  /** Sliding-expiry writes are throttled to once per hour. */
  touchEveryMs: 60 * 60 * 1000,
} as const;

export interface CustomerSessionInfo {
  id: string;
  brandId: string;
  customerId: string;
  csrfHash: string;
}

export interface IssuedCustomerSession {
  customerId: string;
  token: string;
  csrfToken: string;
  maxAgeMs: number;
}

/**
 * Opaque server-side customer sessions, always read and written inside the resolved brand's
 * database scope: a token from one brand is simply not found on another (row-level security),
 * in addition to the explicit brand comparison.
 */
@Injectable()
export class CustomerSessionService {
  constructor(private readonly prisma: PrismaService) {}

  /** Runs `fn` in the brand's scope (the only scope customer data is ever touched with). */
  inBrand<T>(brandId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return withScope(this.prisma.client, { brandIds: [brandId] }, fn);
  }

  async create(
    tx: Prisma.TransactionClient,
    brandId: string,
    customerId: string,
    meta: { ip?: string; userAgent?: string },
  ): Promise<IssuedCustomerSession> {
    const token = generateToken();
    const csrfToken = generateToken();
    const now = Date.now();
    await tx.customerSession.create({
      data: {
        brandId,
        customerId,
        tokenHash: hashToken(token),
        csrfHash: hashToken(csrfToken),
        idleExpiresAt: new Date(now + CUSTOMER_SESSION_POLICY.idleMs),
        absoluteExpiresAt: new Date(now + CUSTOMER_SESSION_POLICY.absoluteMs),
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });
    return { customerId, token, csrfToken, maxAgeMs: CUSTOMER_SESSION_POLICY.absoluteMs };
  }

  /** A live session of an ACTIVE customer of exactly this brand, or null. */
  async authenticate(
    brandId: string,
    token: string | undefined,
  ): Promise<CustomerSessionInfo | null> {
    if (!token || token.length > 200) return null;
    const now = new Date();
    return this.inBrand(brandId, async (tx) => {
      const row = await tx.customerSession.findUnique({
        where: { tokenHash: hashToken(token) },
        include: { customer: { select: { status: true } } },
      });
      if (
        !row ||
        row.brandId !== brandId ||
        row.revokedAt ||
        row.idleExpiresAt <= now ||
        row.absoluteExpiresAt <= now ||
        row.customer.status !== 'ACTIVE'
      ) {
        return null;
      }
      if (now.getTime() - row.lastSeenAt.getTime() > CUSTOMER_SESSION_POLICY.touchEveryMs) {
        await tx.customerSession.update({
          where: { id: row.id },
          data: {
            lastSeenAt: now,
            idleExpiresAt: new Date(
              Math.min(
                now.getTime() + CUSTOMER_SESSION_POLICY.idleMs,
                row.absoluteExpiresAt.getTime(),
              ),
            ),
          },
        });
      }
      return {
        id: row.id,
        brandId: row.brandId,
        customerId: row.customerId,
        csrfHash: row.csrfHash,
      };
    });
  }

  async revoke(tx: Prisma.TransactionClient, sessionId: string): Promise<void> {
    await tx.customerSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAll(
    tx: Prisma.TransactionClient,
    customerId: string,
    exceptSessionId?: string,
  ): Promise<number> {
    const res = await tx.customerSession.updateMany({
      where: {
        customerId,
        revokedAt: null,
        ...(exceptSessionId && { id: { not: exceptSessionId } }),
      },
      data: { revokedAt: new Date() },
    });
    return res.count;
  }
}

export function customerCsrfMatches(
  session: Pick<CustomerSessionInfo, 'csrfHash'>,
  header: string | undefined,
): boolean {
  return typeof header === 'string' && header.length > 0 && header.length < 200
    ? safeEqual(hashToken(header), session.csrfHash)
    : false;
}
