import { randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { RequestContextService } from '../../common/context/request-context.service';
import { ApiException } from '../../common/errors/api-exception';
import { MailPort } from '../../common/mail/mail.port';
import { EncryptionService } from '../../common/security/encryption.service';
import { hashToken } from '../../common/security/tokens';
import { APP_ENV, type Env } from '../../config/env';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthAttemptService } from './attempt.service';
import { PasswordService, passwordProblems } from './password.service';
import { type IssuedSession, type SessionInfo, StaffSessionService } from './session.service';
import { INVITE_TTL_MS, RESET_TTL_MS, consumeStaffToken, issueStaffToken } from './staff-token';
import { TotpService } from './totp.service';

const REALM = 'staff';
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export type NextStep = 'MFA_ENROLL' | 'MFA_VERIFY' | 'DONE';

const invalidCredentials = () =>
  new ApiException(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
const invalidCode = () => new ApiException(401, 'INVALID_CODE', 'Invalid or expired code.');

function newRecoveryCode(): string {
  const chars = Array.from(
    { length: 10 },
    () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)] as string,
  );
  return `${chars.slice(0, 5).join('')}-${chars.slice(5).join('')}`;
}

const normalizeRecovery = (input: string): string => input.toUpperCase().replace(/[^A-Z0-9]/g, '');

function assertPasswordAcceptable(password: string, email: string, fullName?: string): void {
  const problems = passwordProblems(password, { email, fullName });
  if (problems.length > 0) {
    throw new ApiException(
      422,
      'WEAK_PASSWORD',
      'The password does not meet the policy.',
      problems.map((message) => ({ path: 'password', message })),
    );
  }
}

/** Staff authentication flows (docs/PHASE-2-PLAN.md 3.6). Controllers stay thin; rules live here. */
@Injectable()
export class StaffAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly totp: TotpService,
    private readonly sessions: StaffSessionService,
    private readonly attempts: AuthAttemptService,
    private readonly encryption: EncryptionService,
    private readonly audit: AuditService,
    private readonly mail: MailPort,
    private readonly context: RequestContextService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  // ---------------------------------------------------------------- login and 2FA

  /** Step 1: password. Creates a pending session that grants no admin access until 2FA completes. */
  async login(
    emailInput: string,
    password: string,
    skipMfa = false,
  ): Promise<IssuedSession & { next: NextStep }> {
    const email = emailInput.trim().toLowerCase();
    const ip = this.context.ip;
    await this.attempts.assertNotLocked(REALM, email, ip);

    const staff = await this.prisma.client.staffUser.findFirst({
      where: { email },
      include: { totp: { select: { confirmedAt: true } } },
    });
    const usable = staff?.status === 'ACTIVE' && staff.passwordHash !== null;
    const ok = usable
      ? await this.passwords.verify(staff.passwordHash as string, password)
      : await this.passwords.verifyDummy(password);

    if (!staff || !usable || !ok) {
      const locked = await this.attempts.recordFailure(REALM, email, ip);
      await this.audit.recordStandalone({
        action: 'auth.login.failure',
        targetType: 'staff_user',
        targetId: staff?.id,
        actor: { type: staff ? 'STAFF' : 'GUEST', id: staff?.id },
        outcome: 'FAILED',
        after: { email },
      });
      if (locked) {
        await this.audit.recordStandalone({
          action: 'auth.lock',
          targetType: 'staff_user',
          targetId: staff?.id,
          actor: { type: 'SYSTEM' },
          outcome: 'DENIED',
          after: { email },
        });
      }
      throw invalidCredentials();
    }

    const session = await this.sessions.create(staff.id, {
      ip,
      userAgent: this.context.userAgent,
    });
    // Local development only (DEV_SKIP_MFA is false everywhere else, and the API will not start
    // with it on outside NODE_ENV=development): a verified session straight after the password.
    if (skipMfa && this.env.DEV_SKIP_MFA) {
      const issued = await this.finishLogin(session, staff.id, staff.email, {
        mfaSkipped: true,
      });
      return { ...issued, next: 'DONE' };
    }
    return { ...session, next: staff.totp?.confirmedAt ? 'MFA_VERIFY' : 'MFA_ENROLL' };
  }

  /** Starts TOTP enrollment. Only possible while no 2FA is enrolled, so a stolen password cannot replace it. */
  async enrollStart(
    session: SessionInfo,
  ): Promise<{ secret: string; otpauthUri: string; qrDataUrl: string }> {
    const staff = await this.requireStaff(session);
    if (staff.mfaEnrolledAt) {
      throw new ApiException(
        409,
        'MFA_ALREADY_ENROLLED',
        'Two-factor authentication is already set up.',
      );
    }
    const secret = this.totp.generateSecret();
    const ciphertext = this.encryption.encrypt(secret, staff.id);
    await this.prisma.client.staffMfaTotp.upsert({
      where: { staffUserId: staff.id },
      create: { staffUserId: staff.id, secretCiphertext: ciphertext },
      update: { secretCiphertext: ciphertext, confirmedAt: null, lastUsedStep: null },
    });
    const otpauthUri = this.totp.otpauthUri(staff.email, secret);
    return { secret, otpauthUri, qrDataUrl: await this.totp.qrDataUrl(otpauthUri) };
  }

  /** Confirms enrollment with a first code, issues recovery codes once, and completes the login. */
  async enrollConfirm(
    session: SessionInfo,
    code: string,
  ): Promise<IssuedSession & { recoveryCodes: string[] }> {
    const staff = await this.requireStaff(session);
    await this.attempts.assertNotLocked(REALM, staff.email, this.context.ip);
    const record = await this.prisma.client.staffMfaTotp.findUnique({
      where: { staffUserId: staff.id },
    });
    if (staff.mfaEnrolledAt || !record || record.confirmedAt) {
      throw new ApiException(409, 'MFA_NOT_PENDING', 'There is no enrollment to confirm.');
    }
    const step = this.totp.verify(this.encryption.decrypt(record.secretCiphertext, staff.id), code);
    if (step === null) throw await this.mfaFailure(staff.id, staff.email, 'enroll');

    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
    await this.prisma.client.$transaction(async (tx) => {
      await tx.staffMfaTotp.update({
        where: { staffUserId: staff.id },
        data: { confirmedAt: new Date(), lastUsedStep: BigInt(step) },
      });
      await tx.staffUser.update({
        where: { id: staff.id },
        data: { mfaEnrolledAt: new Date(), lastLoginAt: new Date() },
      });
      await tx.staffRecoveryCode.deleteMany({ where: { staffUserId: staff.id } });
      await tx.staffRecoveryCode.createMany({
        data: recoveryCodes.map((c) => ({
          staffUserId: staff.id,
          codeHash: hashToken(normalizeRecovery(c)),
        })),
      });
      await this.audit.record(tx, {
        action: 'auth.mfa.enroll',
        targetType: 'staff_user',
        targetId: staff.id,
        actor: { type: 'STAFF', id: staff.id },
      });
    });
    const issued = await this.finishLogin(session, staff.id, staff.email);
    return { ...issued, recoveryCodes };
  }

  /** Step 2: TOTP code for an enrolled account. */
  async mfaVerify(session: SessionInfo, code: string): Promise<IssuedSession> {
    const staff = await this.requireStaff(session);
    await this.attempts.assertNotLocked(REALM, staff.email, this.context.ip);
    if (!staff.mfaEnrolledAt) {
      throw new ApiException(409, 'MFA_NOT_ENROLLED', 'Set up two-factor authentication first.');
    }
    if (!(await this.consumeTotp(staff.id, code))) {
      throw await this.mfaFailure(staff.id, staff.email, 'verify');
    }
    return this.finishLogin(session, staff.id, staff.email);
  }

  /** Alternative to TOTP: a single-use recovery code. */
  async recover(
    session: SessionInfo,
    code: string,
  ): Promise<IssuedSession & { remainingCodes: number }> {
    const staff = await this.requireStaff(session);
    await this.attempts.assertNotLocked(REALM, staff.email, this.context.ip);
    const used = await this.prisma.client.staffRecoveryCode.updateMany({
      where: {
        staffUserId: staff.id,
        codeHash: hashToken(normalizeRecovery(code)),
        usedAt: null,
      },
      data: { usedAt: new Date() },
    });
    if (!staff.mfaEnrolledAt || used.count !== 1) {
      throw await this.mfaFailure(staff.id, staff.email, 'recovery');
    }
    await this.audit.recordStandalone({
      action: 'auth.recovery.used',
      targetType: 'staff_user',
      targetId: staff.id,
      actor: { type: 'STAFF', id: staff.id },
    });
    const issued = await this.finishLogin(session, staff.id, staff.email);
    const remainingCodes = await this.prisma.client.staffRecoveryCode.count({
      where: { staffUserId: staff.id, usedAt: null },
    });
    return { ...issued, remainingCodes };
  }

  /** Re-confirms 2FA to unlock sensitive actions for the step-up window. */
  async stepUp(session: SessionInfo, code: string): Promise<{ stepUpUntil: Date }> {
    const staff = await this.requireStaff(session);
    await this.attempts.assertNotLocked(REALM, staff.email, this.context.ip);
    if (!(await this.consumeTotp(staff.id, code))) {
      throw await this.mfaFailure(staff.id, staff.email, 'step-up');
    }
    const stepUpUntil = await this.sessions.grantStepUp(session.id);
    await this.audit.recordStandalone({
      action: 'auth.step_up',
      targetType: 'staff_user',
      targetId: staff.id,
      actor: { type: 'STAFF', id: staff.id },
    });
    return { stepUpUntil };
  }

  async logout(session: SessionInfo): Promise<void> {
    await this.sessions.revoke(session.id);
    await this.audit.recordStandalone({
      action: 'auth.logout',
      targetType: 'staff_user',
      targetId: session.staffUserId,
      actor: { type: 'STAFF', id: session.staffUserId },
    });
  }

  async logoutAll(session: SessionInfo): Promise<number> {
    const revoked = await this.sessions.revokeAll(session.staffUserId);
    await this.audit.recordStandalone({
      action: 'auth.logout_all',
      targetType: 'staff_user',
      targetId: session.staffUserId,
      actor: { type: 'STAFF', id: session.staffUserId },
      after: { revoked },
    });
    return revoked;
  }

  // ---------------------------------------------------------------- passwords and invites

  async changePassword(session: SessionInfo, current: string, next: string): Promise<void> {
    const staff = await this.requireStaff(session);
    await this.attempts.assertNotLocked(REALM, staff.email, this.context.ip);
    const ok =
      staff.passwordHash !== null && (await this.passwords.verify(staff.passwordHash, current));
    if (!ok) {
      await this.attempts.recordFailure(REALM, staff.email, this.context.ip);
      throw new ApiException(401, 'INVALID_CREDENTIALS', 'The current password is incorrect.');
    }
    assertPasswordAcceptable(next, staff.email, staff.fullName);
    const hash = await this.passwords.hash(next);
    await this.prisma.client.$transaction(async (tx) => {
      await tx.staffUser.update({ where: { id: staff.id }, data: { passwordHash: hash } });
      await this.audit.record(tx, {
        action: 'auth.password.change',
        targetType: 'staff_user',
        targetId: staff.id,
        actor: { type: 'STAFF', id: staff.id },
      });
    });
    await this.sessions.revokeAll(staff.id, session.id);
  }

  /** Always succeeds from the caller's view; a link is sent only for active staff accounts. */
  async forgotPassword(emailInput: string): Promise<void> {
    const email = emailInput.trim().toLowerCase();
    const staff = await this.prisma.client.staffUser.findFirst({ where: { email } });
    if (!staff || staff.status !== 'ACTIVE') return;
    const token = await this.prisma.client.$transaction((tx) =>
      issueStaffToken(tx, staff.id, 'RESET', RESET_TTL_MS),
    );
    await this.audit.recordStandalone({
      action: 'auth.password.forgot',
      targetType: 'staff_user',
      targetId: staff.id,
      actor: { type: 'GUEST' },
    });
    await this.mail.send({
      to: staff.email,
      subject: 'Reset your Matilda admin password',
      template: 'staff.password_reset',
      text: `Use this link within 1 hour to choose a new password:\n${this.link('reset-password', token)}\n\nIf you did not ask for this, ignore this email.`,
    });
  }

  async resetPassword(token: string, password: string): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      const staffId = await consumeStaffToken(tx, token, 'RESET');
      const staff = staffId ? await tx.staffUser.findUnique({ where: { id: staffId } }) : null;
      if (!staff || staff.status !== 'ACTIVE') {
        throw new ApiException(400, 'INVALID_TOKEN', 'This link is invalid or has expired.');
      }
      assertPasswordAcceptable(password, staff.email, staff.fullName);
      await tx.staffUser.update({
        where: { id: staff.id },
        data: { passwordHash: await this.passwords.hash(password) },
      });
      await tx.staffSession.updateMany({
        where: { staffUserId: staff.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(tx, {
        action: 'auth.password.reset',
        targetType: 'staff_user',
        targetId: staff.id,
        actor: { type: 'GUEST' },
      });
    });
  }

  /** Accepts an invitation: sets the first password and activates the account (2FA is enrolled at first login). */
  async acceptInvite(token: string, password: string): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      const staffId = await consumeStaffToken(tx, token, 'INVITE');
      const staff = staffId ? await tx.staffUser.findUnique({ where: { id: staffId } }) : null;
      if (!staff || staff.status !== 'INVITED') {
        throw new ApiException(400, 'INVALID_TOKEN', 'This link is invalid or has expired.');
      }
      assertPasswordAcceptable(password, staff.email, staff.fullName);
      await tx.staffUser.update({
        where: { id: staff.id },
        data: { passwordHash: await this.passwords.hash(password), status: 'ACTIVE' },
      });
      await this.audit.record(tx, {
        action: 'auth.invite.accept',
        targetType: 'staff_user',
        targetId: staff.id,
        actor: { type: 'STAFF', id: staff.id },
      });
    });
  }

  /**
   * Issues an invitation for an INVITED staff member and emails the link. The link is also returned
   * so the inviter can share it manually until a mail provider exists (D2-11).
   */
  async invite(staffUserId: string, invitedById: string): Promise<{ link: string }> {
    const staff = await this.prisma.client.staffUser.findUnique({ where: { id: staffUserId } });
    if (!staff || staff.status !== 'INVITED') {
      throw new ApiException(409, 'NOT_INVITABLE', 'Only invited staff can receive an invitation.');
    }
    const token = await this.prisma.client.$transaction(async (tx) => {
      const issued = await issueStaffToken(tx, staffUserId, 'INVITE', INVITE_TTL_MS);
      await this.audit.record(tx, {
        action: 'auth.invite.issue',
        targetType: 'staff_user',
        targetId: staffUserId,
        actor: { type: 'STAFF', id: invitedById },
      });
      return issued;
    });
    const link = this.link('accept-invite', token);
    await this.mail.send({
      to: staff.email,
      subject: 'You have been invited to Matilda admin',
      template: 'staff.invite',
      text: `Set your password within 72 hours:\n${link}`,
    });
    return { link };
  }

  async me(session: SessionInfo) {
    const staff = await this.requireStaff(session);
    return {
      id: staff.id,
      email: staff.email,
      fullName: staff.fullName,
      mfaEnrolled: staff.mfaEnrolledAt !== null,
      sessionExpiresAt: session.absoluteExpiresAt.toISOString(),
      stepUpUntil: session.stepUpUntil?.toISOString() ?? null,
    };
  }

  // ---------------------------------------------------------------- internals

  private link(path: string, token: string): string {
    return `${this.env.ADMIN_BASE_URL.replace(/\/$/, '')}/${path}?token=${token}`;
  }

  private async requireStaff(session: SessionInfo) {
    const staff = await this.prisma.client.staffUser.findUnique({
      where: { id: session.staffUserId },
    });
    if (!staff || staff.status !== 'ACTIVE') {
      throw new ApiException(401, 'UNAUTHENTICATED', 'Authentication required');
    }
    return staff;
  }

  /** Verifies a TOTP code and burns its time step atomically (replay and race safe). */
  private async consumeTotp(staffUserId: string, code: string): Promise<boolean> {
    const record = await this.prisma.client.staffMfaTotp.findUnique({ where: { staffUserId } });
    if (!record?.confirmedAt) return false;
    const step = this.totp.verify(
      this.encryption.decrypt(record.secretCiphertext, staffUserId),
      code,
    );
    if (step === null) return false;
    const updated = await this.prisma.client.$executeRaw`
      UPDATE staff_mfa_totp SET last_used_step = ${BigInt(step)}
      WHERE staff_user_id = ${staffUserId}::uuid AND confirmed_at IS NOT NULL
        AND (last_used_step IS NULL OR last_used_step < ${BigInt(step)})`;
    return updated === 1;
  }

  private async mfaFailure(staffId: string, email: string, stage: string): Promise<ApiException> {
    const locked = await this.attempts.recordFailure(REALM, email, this.context.ip);
    await this.audit.recordStandalone({
      action: 'auth.mfa.failure',
      targetType: 'staff_user',
      targetId: staffId,
      actor: { type: 'STAFF', id: staffId },
      outcome: 'FAILED',
      after: { stage },
    });
    if (locked) {
      await this.audit.recordStandalone({
        action: 'auth.lock',
        targetType: 'staff_user',
        targetId: staffId,
        actor: { type: 'SYSTEM' },
        outcome: 'DENIED',
      });
    }
    return invalidCode();
  }

  private async finishLogin(
    session: Pick<SessionInfo, 'id'>,
    staffId: string,
    email: string,
    extra?: Record<string, unknown>,
  ): Promise<IssuedSession> {
    await this.attempts.recordSuccess(REALM, email, this.context.ip);
    await this.prisma.client.staffUser.update({
      where: { id: staffId },
      data: { lastLoginAt: new Date() },
    });
    const issued = await this.sessions.markVerified(session.id);
    await this.audit.recordStandalone({
      action: 'auth.login.success',
      targetType: 'staff_user',
      targetId: staffId,
      actor: { type: 'STAFF', id: staffId },
      ...(extra && { after: extra }),
    });
    return issued;
  }
}
