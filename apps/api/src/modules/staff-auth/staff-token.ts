import { generateToken, hashToken } from '../../common/security/tokens';
import type { Prisma, StaffTokenType } from '../../generated/prisma/client';

export const INVITE_TTL_MS = 72 * 60 * 60 * 1000;
export const RESET_TTL_MS = 60 * 60 * 1000;

/**
 * Creates a single-use invite/reset token, invalidating earlier unused tokens of the same type for
 * that staff member. Only the hash is stored; the returned plaintext goes into the link exactly once.
 */
export async function issueStaffToken(
  tx: Prisma.TransactionClient,
  staffUserId: string,
  type: StaffTokenType,
  ttlMs: number,
): Promise<string> {
  await tx.staffToken.updateMany({
    where: { staffUserId, type, usedAt: null },
    data: { usedAt: new Date() },
  });
  const token = generateToken();
  await tx.staffToken.create({
    data: {
      staffUserId,
      type,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + ttlMs),
    },
  });
  return token;
}

/** Atomically marks a valid token as used and returns its staff member, or null (reuse, expiry, unknown). */
export async function consumeStaffToken(
  tx: Prisma.TransactionClient,
  token: string,
  type: StaffTokenType,
): Promise<string | null> {
  if (!token || token.length > 200) return null;
  const rows = await tx.$queryRaw<{ staff_user_id: string }[]>`
    UPDATE staff_token SET used_at = now()
    WHERE token_hash = ${hashToken(token)} AND type = ${type}::"StaffTokenType"
      AND used_at IS NULL AND expires_at > now()
    RETURNING staff_user_id`;
  return rows[0]?.staff_user_id ?? null;
}
