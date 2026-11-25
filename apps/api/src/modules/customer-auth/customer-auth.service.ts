import { Inject, Injectable } from '@nestjs/common';
import { ApiException } from '../../common/errors/api-exception';
import { RequestContextService } from '../../common/context/request-context.service';
import { MailPort } from '../../common/mail/mail.port';
import { useSecureCookies } from '../../common/security/cookies';
import { generateToken, hashToken } from '../../common/security/tokens';
import { APP_ENV, type Env } from '../../config/env';
import type { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthAttemptService } from '../staff-auth/attempt.service';
import {
  CUSTOMER_PASSWORD_MIN_LENGTH,
  PasswordService,
  passwordProblems,
} from '../staff-auth/password.service';
import type { ResolvedTenant } from '../tenancy/tenant-resolver.service';
import {
  type CustomerSessionInfo,
  CustomerSessionService,
  type IssuedCustomerSession,
} from './customer-session.service';

const HOUR = 60 * 60 * 1000;
export const VERIFY_TTL_MS = 24 * HOUR;
export const RESET_TTL_MS = 1 * HOUR;

export interface RegisterInput {
  email: string;
  password: string;
  fullName: string;
  phone?: string;
  marketingConsent?: boolean;
}

export interface ProfilePatch {
  fullName?: string;
  phone?: string | null;
  preferredLanguage?: string | null;
  marketingConsent?: boolean;
}

const invalidCredentials = () =>
  new ApiException(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
const invalidToken = () =>
  new ApiException(400, 'INVALID_TOKEN', 'This link is invalid or has expired.');

/** Never exposes credentials or internal flags. */
const PUBLIC = {
  id: true,
  email: true,
  emailVerifiedAt: true,
  phone: true,
  fullName: true,
  preferredLanguage: true,
  status: true,
  marketingConsent: true,
  marketingConsentAt: true,
  createdAt: true,
} satisfies Prisma.CustomerSelect;

/**
 * Customer accounts are per brand: every query below runs in the resolved brand's database scope
 * and filters by brand id, so one brand's customer can never be read, matched or logged into from
 * another. Registration, password reset and login answer identically for existing and unknown
 * emails.
 */
@Injectable()
export class CustomerAuthService {
  constructor(
    private readonly sessions: CustomerSessionService,
    private readonly passwords: PasswordService,
    private readonly attempts: AuthAttemptService,
    private readonly audit: AuditService,
    private readonly mail: MailPort,
    private readonly context: RequestContextService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  private realm = (brandId: string) => `customer:${brandId}`;

  private origin(tenant: ResolvedTenant): string {
    return `${useSecureCookies(this.env.NODE_ENV) ? 'https' : 'http'}://${tenant.hostname}`;
  }

  private link(tenant: ResolvedTenant, path: string, token: string): string {
    return `${this.origin(tenant)}/${path}?token=${token}`;
  }

  private assertPassword(password: string, email: string, fullName?: string): void {
    const problems = passwordProblems(password, {
      email,
      fullName,
      minLength: CUSTOMER_PASSWORD_MIN_LENGTH,
    });
    if (problems.length > 0) {
      throw new ApiException(
        422,
        'WEAK_PASSWORD',
        'The password does not meet the policy.',
        problems.map((message) => ({ path: 'password', message })),
      );
    }
  }

  private async issueToken(
    tx: Prisma.TransactionClient,
    brandId: string,
    customerId: string,
    type: 'VERIFY_EMAIL' | 'RESET',
    ttlMs: number,
  ): Promise<string> {
    await tx.customerToken.updateMany({
      where: { customerId, type, usedAt: null },
      data: { usedAt: new Date() },
    });
    const token = generateToken();
    await tx.customerToken.create({
      data: {
        brandId,
        customerId,
        type,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + ttlMs),
      },
    });
    return token;
  }

  private async consumeToken(
    tx: Prisma.TransactionClient,
    brandId: string,
    token: string,
    type: 'VERIFY_EMAIL' | 'RESET',
  ): Promise<string> {
    if (!token || token.length > 200) throw invalidToken();
    const rows = await tx.$queryRaw<{ customer_id: string }[]>`
      UPDATE customer_token SET used_at = now()
      WHERE token_hash = ${hashToken(token)} AND brand_id = ${brandId}::uuid
        AND type = ${type}::"CustomerTokenType" AND used_at IS NULL AND expires_at > now()
      RETURNING customer_id`;
    const id = rows[0]?.customer_id;
    if (!id) throw invalidToken();
    return id;
  }

  // ------------------------------------------------------------------ registration

  /** Always resolves the same way; an existing address receives an "already registered" mail instead. */
  async register(tenant: ResolvedTenant, input: RegisterInput): Promise<void> {
    const brandId = tenant.brand.id;
    const email = input.email.trim().toLowerCase();
    this.assertPassword(input.password, email, input.fullName);
    const passwordHash = await this.passwords.hash(input.password);

    const outcome = await this.sessions.inBrand(brandId, async (tx) => {
      if (await tx.customer.findUnique({ where: { brandId_email: { brandId, email } } })) {
        return { created: false as const };
      }
      const customer = await tx.customer.create({
        data: {
          brandId,
          email,
          passwordHash,
          fullName: input.fullName,
          phone: input.phone,
          marketingConsent: input.marketingConsent === true,
          marketingConsentAt: input.marketingConsent ? new Date() : null,
          marketingConsentSource: input.marketingConsent ? 'registration' : null,
        },
      });
      const token = await this.issueToken(tx, brandId, customer.id, 'VERIFY_EMAIL', VERIFY_TTL_MS);
      await this.audit.record(tx, {
        action: 'customer.register',
        targetType: 'customer',
        targetId: customer.id,
        actor: { type: 'CUSTOMER', id: customer.id },
        brandId,
        after: { email },
      });
      return { created: true as const, token };
    });

    if (outcome.created) {
      await this.mail.send({
        to: email,
        subject: 'Confirm your email address',
        template: 'customer.verify',
        text: `Confirm your email within 24 hours:\n${this.link(tenant, 'account/verify-email', outcome.token)}`,
      });
    } else {
      await this.mail.send({
        to: email,
        subject: 'You already have an account',
        template: 'customer.exists',
        text: `An account with this email already exists. Sign in, or reset your password:\n${this.origin(tenant)}/account/forgot-password`,
      });
    }
  }

  async verifyEmail(tenant: ResolvedTenant, token: string): Promise<void> {
    const brandId = tenant.brand.id;
    await this.sessions.inBrand(brandId, async (tx) => {
      const customerId = await this.consumeToken(tx, brandId, token, 'VERIFY_EMAIL');
      await tx.customer.updateMany({
        where: { id: customerId, emailVerifiedAt: null },
        data: { emailVerifiedAt: new Date() },
      });
      await this.audit.record(tx, {
        action: 'customer.email.verify',
        targetType: 'customer',
        targetId: customerId,
        actor: { type: 'CUSTOMER', id: customerId },
        brandId,
      });
    });
  }

  async resendVerification(tenant: ResolvedTenant, session: CustomerSessionInfo): Promise<void> {
    const brandId = tenant.brand.id;
    const issued = await this.sessions.inBrand(brandId, async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id: session.customerId } });
      if (!customer || customer.emailVerifiedAt) return null;
      const token = await this.issueToken(tx, brandId, customer.id, 'VERIFY_EMAIL', VERIFY_TTL_MS);
      return { email: customer.email, token };
    });
    if (issued) {
      await this.mail.send({
        to: issued.email,
        subject: 'Confirm your email address',
        template: 'customer.verify',
        text: `Confirm your email within 24 hours:\n${this.link(tenant, 'account/verify-email', issued.token)}`,
      });
    }
  }

  // ------------------------------------------------------------------ login and logout

  async login(
    tenant: ResolvedTenant,
    emailInput: string,
    password: string,
  ): Promise<IssuedCustomerSession> {
    const brandId = tenant.brand.id;
    const email = emailInput.trim().toLowerCase();
    const ip = this.context.ip;
    await this.attempts.assertNotLocked(this.realm(brandId), email, ip);

    const customer = await this.sessions.inBrand(brandId, (tx) =>
      tx.customer.findUnique({ where: { brandId_email: { brandId, email } } }),
    );
    const usable = customer?.status === 'ACTIVE';
    const ok = usable
      ? await this.passwords.verify(customer.passwordHash, password)
      : await this.passwords.verifyDummy(password);

    if (!customer || !usable || !ok) {
      const locked = await this.attempts.recordFailure(this.realm(brandId), email, ip);
      await this.audit.recordStandalone({
        action: 'customer.login.failure',
        targetType: 'customer',
        targetId: customer?.id,
        actor: { type: customer ? 'CUSTOMER' : 'GUEST', id: customer?.id },
        brandId,
        outcome: 'FAILED',
        after: { email },
      });
      if (locked) {
        await this.audit.recordStandalone({
          action: 'customer.lock',
          targetType: 'customer',
          targetId: customer?.id,
          actor: { type: 'SYSTEM' },
          brandId,
          outcome: 'DENIED',
          after: { email },
        });
      }
      throw invalidCredentials();
    }

    await this.attempts.recordSuccess(this.realm(brandId), email, ip);
    return this.sessions.inBrand(brandId, async (tx) => {
      const issued = await this.sessions.create(tx, brandId, customer.id, {
        ip,
        userAgent: this.context.userAgent,
      });
      await tx.customer.update({ where: { id: customer.id }, data: { lastLoginAt: new Date() } });
      await this.audit.record(tx, {
        action: 'customer.login.success',
        targetType: 'customer',
        targetId: customer.id,
        actor: { type: 'CUSTOMER', id: customer.id },
        brandId,
      });
      return issued;
    });
  }

  async logout(session: CustomerSessionInfo): Promise<void> {
    await this.sessions.inBrand(session.brandId, async (tx) => {
      await this.sessions.revoke(tx, session.id);
      await this.audit.record(tx, {
        action: 'customer.logout',
        targetType: 'customer',
        targetId: session.customerId,
        actor: { type: 'CUSTOMER', id: session.customerId },
        brandId: session.brandId,
      });
    });
  }

  // ------------------------------------------------------------------ passwords

  /** Always resolves; mails a reset link only for an active account of this brand. */
  async forgotPassword(tenant: ResolvedTenant, emailInput: string): Promise<void> {
    const brandId = tenant.brand.id;
    const email = emailInput.trim().toLowerCase();
    const issued = await this.sessions.inBrand(brandId, async (tx) => {
      const customer = await tx.customer.findUnique({
        where: { brandId_email: { brandId, email } },
      });
      if (!customer || customer.status !== 'ACTIVE') return null;
      const token = await this.issueToken(tx, brandId, customer.id, 'RESET', RESET_TTL_MS);
      await this.audit.record(tx, {
        action: 'customer.password.forgot',
        targetType: 'customer',
        targetId: customer.id,
        actor: { type: 'CUSTOMER', id: customer.id },
        brandId,
      });
      return token;
    });
    if (issued) {
      await this.mail.send({
        to: email,
        subject: 'Reset your password',
        template: 'customer.reset',
        text: `Reset your password within 1 hour:\n${this.link(tenant, 'account/reset-password', issued)}`,
      });
    }
  }

  async resetPassword(tenant: ResolvedTenant, token: string, password: string): Promise<void> {
    const brandId = tenant.brand.id;
    const hash = await this.passwords.hash(password);
    await this.sessions.inBrand(brandId, async (tx) => {
      const customerId = await this.consumeToken(tx, brandId, token, 'RESET');
      const customer = await tx.customer.findUniqueOrThrow({ where: { id: customerId } });
      this.assertPassword(password, customer.email, customer.fullName);
      await tx.customer.update({
        where: { id: customerId },
        data: {
          passwordHash: hash,
          // Receiving the link proves control of the mailbox.
          emailVerifiedAt: customer.emailVerifiedAt ?? new Date(),
        },
      });
      await this.sessions.revokeAll(tx, customerId);
      await this.audit.record(tx, {
        action: 'customer.password.reset',
        targetType: 'customer',
        targetId: customerId,
        actor: { type: 'CUSTOMER', id: customerId },
        brandId,
      });
    });
    // A weak password rolls back the transaction above, so the link stays usable for a retry.
  }

  async changePassword(session: CustomerSessionInfo, current: string, next: string): Promise<void> {
    const brandId = session.brandId;
    await this.sessions.inBrand(brandId, async (tx) => {
      const customer = await tx.customer.findUniqueOrThrow({ where: { id: session.customerId } });
      if (!(await this.passwords.verify(customer.passwordHash, current))) {
        throw new ApiException(401, 'INVALID_CREDENTIALS', 'The current password is incorrect.');
      }
      this.assertPassword(next, customer.email, customer.fullName);
      await tx.customer.update({
        where: { id: customer.id },
        data: { passwordHash: await this.passwords.hash(next) },
      });
      await this.sessions.revokeAll(tx, customer.id, session.id);
      await this.audit.record(tx, {
        action: 'customer.password.change',
        targetType: 'customer',
        targetId: customer.id,
        actor: { type: 'CUSTOMER', id: customer.id },
        brandId,
      });
    });
  }

  // ------------------------------------------------------------------ profile and deletion

  me(session: CustomerSessionInfo) {
    return this.sessions.inBrand(session.brandId, (tx) =>
      tx.customer.findUniqueOrThrow({ where: { id: session.customerId }, select: PUBLIC }),
    );
  }

  updateMe(session: CustomerSessionInfo, patch: ProfilePatch) {
    return this.sessions.inBrand(session.brandId, async (tx) => {
      const before = await tx.customer.findUniqueOrThrow({ where: { id: session.customerId } });
      const consentChanged =
        patch.marketingConsent !== undefined && patch.marketingConsent !== before.marketingConsent;
      const updated = await tx.customer.update({
        where: { id: before.id },
        data: {
          fullName: patch.fullName,
          phone: patch.phone,
          preferredLanguage: patch.preferredLanguage,
          ...(consentChanged && {
            marketingConsent: patch.marketingConsent,
            marketingConsentAt: new Date(),
            marketingConsentSource: 'account',
          }),
        },
        select: PUBLIC,
      });
      await this.audit.record(tx, {
        action: 'customer.profile.update',
        targetType: 'customer',
        targetId: before.id,
        actor: { type: 'CUSTOMER', id: before.id },
        brandId: session.brandId,
        after: { fields: Object.keys(patch) },
      });
      return updated;
    });
  }

  /**
   * Records the request, blocks sign-in and ends every session. Anonymization of the personal data
   * (retention-aware: orders and invoices are kept as required) is a later, owner-reviewed step.
   */
  async requestDeletion(session: CustomerSessionInfo, password: string): Promise<void> {
    await this.sessions.inBrand(session.brandId, async (tx) => {
      const customer = await tx.customer.findUniqueOrThrow({ where: { id: session.customerId } });
      if (!(await this.passwords.verify(customer.passwordHash, password))) {
        throw new ApiException(401, 'INVALID_CREDENTIALS', 'The password is incorrect.');
      }
      await tx.customer.update({
        where: { id: customer.id },
        data: { status: 'DELETION_REQUESTED', deletionRequestedAt: new Date() },
      });
      await this.sessions.revokeAll(tx, customer.id);
      await this.audit.record(tx, {
        action: 'customer.deletion.request',
        targetType: 'customer',
        targetId: customer.id,
        actor: { type: 'CUSTOMER', id: customer.id },
        brandId: session.brandId,
      });
    });
  }
}
