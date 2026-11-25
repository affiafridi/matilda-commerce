import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Opaque random token for sessions, invites, resets and CSRF (base64url, 256-bit by default). */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Tokens are stored hashed; a database leak must not reveal usable sessions or links. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
