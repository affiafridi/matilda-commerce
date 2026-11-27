import { Injectable } from '@nestjs/common';
import { generateToken, hashToken, safeEqual } from '../../common/security/tokens';
import { PrismaService } from '../../database/prisma.service';

const MINUTE = 60_000;
export const STAFF_SESSION_POLICY = {
  idleMs: 30 * MINUTE,
  absoluteMs: 12 * 60 * MINUTE,
  /** A session that has not completed 2FA dies quickly and grants nothing. */
  pendingAbsoluteMs: 15 * MINUTE,
  stepUpMs: 10 * MINUTE,
  /** Sliding-expiry writes are throttled to once per minute. */
  touchEveryMs: MINUTE,
} as const;

export interface SessionInfo {
  id: string;
  staffUserId: string;
  mfaVerified: boolean;
  stepUpUntil: Date | null;
  absoluteExpiresAt: Date;
  csrfHash: string;
}

export interface IssuedSession {
  token: string;
  csrfToken: string;
  maxAgeMs: number;
}

/**
 * Opaque server-side sessions (D2-01). The cookie holds a random token; only its hash is stored, so a
 * database leak yields no usable sessions. A session is "pending" until 2FA completes, and its token
 * is rotated at that moment (session-fixation defence).
 */
@Injectable()
export class StaffSessionService {
  constructor(private readonly prisma: PrismaService) {}

  /** Creates a pending (pre-2FA) session. */
  async create(
    staffUserId: string,
    meta: { ip?: string; userAgent?: string },
  ): Promise<IssuedSession & { id: string }> {
    const token = generateToken();
    const csrfToken = generateToken();
    const now = Date.now();
    const row = await this.prisma.client.staffSession.create({
      data: {
        staffUserId,
        tokenHash: hashToken(token),
        csrfHash: hashToken(csrfToken),
        idleExpiresAt: new Date(now + STAFF_SESSION_POLICY.idleMs),
        absoluteExpiresAt: new Date(now + STAFF_SESSION_POLICY.pendingAbsoluteMs),
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });
    return { id: row.id, token, csrfToken, maxAgeMs: STAFF_SESSION_POLICY.pendingAbsoluteMs };
  }

  /**
   * Resolves a cookie token to a live session of an ACTIVE staff member, or null.
   * `verifiedOnly` rejects pending (pre-2FA) sessions.
   */
  async authenticate(
    token: string | undefined,
    options: { verifiedOnly: boolean },
  ): Promise<SessionInfo | null> {
    if (!token || token.length > 200) return null;
    const now = new Date();
    const row = await this.prisma.client.staffSession.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { staffUser: { select: { status: true } } },
    });
    if (
      !row ||
      row.revokedAt ||
      row.idleExpiresAt <= now ||
      row.absoluteExpiresAt <= now ||
      row.staffUser.status !== 'ACTIVE' ||
      (options.verifiedOnly && !row.mfaVerifiedAt)
    ) {
      return null;
    }
    if (now.getTime() - row.lastSeenAt.getTime() > STAFF_SESSION_POLICY.touchEveryMs) {
      await this.prisma.client.staffSession.update({
        where: { id: row.id },
        data: {
          lastSeenAt: now,
          idleExpiresAt: new Date(
            Math.min(now.getTime() + STAFF_SESSION_POLICY.idleMs, row.absoluteExpiresAt.getTime()),
          ),
        },
      });
    }
    return {
      id: row.id,
      staffUserId: row.staffUserId,
      mfaVerified: row.mfaVerifiedAt !== null,
      stepUpUntil: row.stepUpUntil,
      absoluteExpiresAt: row.absoluteExpiresAt,
      csrfHash: row.csrfHash,
    };
  }

  /** Completes 2FA: rotates the token and CSRF secret, extends lifetime, opens the step-up window. */
  async markVerified(sessionId: string): Promise<IssuedSession> {
    const token = generateToken();
    const csrfToken = generateToken();
    const now = Date.now();
    await this.prisma.client.staffSession.update({
      where: { id: sessionId },
      data: {
        tokenHash: hashToken(token),
        csrfHash: hashToken(csrfToken),
        mfaVerifiedAt: new Date(now),
        stepUpUntil: new Date(now + STAFF_SESSION_POLICY.stepUpMs),
        lastSeenAt: new Date(now),
        idleExpiresAt: new Date(now + STAFF_SESSION_POLICY.idleMs),
        absoluteExpiresAt: new Date(now + STAFF_SESSION_POLICY.absoluteMs),
      },
    });
    return { token, csrfToken, maxAgeMs: STAFF_SESSION_POLICY.absoluteMs };
  }

  /** Issues a fresh CSRF secret for a live session (the browser keeps it in memory only). */
  async rotateCsrf(sessionId: string): Promise<string> {
    const csrfToken = generateToken();
    await this.prisma.client.staffSession.update({
      where: { id: sessionId },
      data: { csrfHash: hashToken(csrfToken) },
    });
    return csrfToken;
  }

  async grantStepUp(sessionId: string): Promise<Date> {
    const until = new Date(Date.now() + STAFF_SESSION_POLICY.stepUpMs);
    await this.prisma.client.staffSession.update({
      where: { id: sessionId },
      data: { stepUpUntil: until },
    });
    return until;
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.client.staffSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Revokes every live session of a staff member (optionally keeping one). Returns how many. */
  async revokeAll(staffUserId: string, exceptSessionId?: string): Promise<number> {
    const res = await this.prisma.client.staffSession.updateMany({
      where: {
        staffUserId,
        revokedAt: null,
        ...(exceptSessionId && { id: { not: exceptSessionId } }),
      },
      data: { revokedAt: new Date() },
    });
    return res.count;
  }

  /** Housekeeping for a scheduled job (introduced with background jobs). */
  async purgeExpired(): Promise<number> {
    const res = await this.prisma.client.staffSession.deleteMany({
      where: { absoluteExpiresAt: { lt: new Date(Date.now() - 24 * 60 * MINUTE) } },
    });
    return res.count;
  }
}

export function csrfMatches(
  session: Pick<SessionInfo, 'csrfHash'>,
  header: string | undefined,
): boolean {
  return typeof header === 'string' && header.length > 0 && header.length < 200
    ? safeEqual(hashToken(header), session.csrfHash)
    : false;
}
