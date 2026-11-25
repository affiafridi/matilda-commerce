import { Inject, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { APP_ENV, type Env } from '../../config/env';

/** OWASP-recommended Argon2id baseline (19 MiB, 2 passes, 1 lane); tune upwards on production hardware. */
export const ARGON2_PARAMS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export const PASSWORD_MIN_LENGTH = 12;
export const CUSTOMER_PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

const DENYLIST = [
  'password1234',
  'password12345',
  '123456789012',
  '1234567890123',
  'qwertyuiop12',
  'qwerty123456',
  'letmein12345',
  'welcome12345',
  'administrator',
  'changeme1234',
  'iloveyou1234',
];

export interface PasswordContext {
  email?: string;
  fullName?: string;
  /** Defaults to the staff minimum. */
  minLength?: number;
}

/** Returns human-readable problems; empty means the password is acceptable. */
export function passwordProblems(password: string, context: PasswordContext = {}): string[] {
  const problems: string[] = [];
  const min = context.minLength ?? PASSWORD_MIN_LENGTH;
  if (password.length < min) {
    problems.push(`Use at least ${min} characters.`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    problems.push(`Use at most ${PASSWORD_MAX_LENGTH} characters.`);
  }
  const lower = password.toLowerCase();
  if (DENYLIST.some((p) => lower.includes(p))) {
    problems.push('This password is too common.');
  }
  if (new Set(password).size < 5) {
    problems.push('Use a greater variety of characters.');
  }
  const local = context.email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) {
    problems.push('The password must not contain your email name.');
  }
  return problems;
}

@Injectable()
export class PasswordService {
  private dummyHash: Promise<string> | undefined;

  constructor(@Inject(APP_ENV) private readonly env: Env) {}

  private get secret(): Buffer | undefined {
    return this.env.PASSWORD_PEPPER ? Buffer.from(this.env.PASSWORD_PEPPER, 'utf8') : undefined;
  }

  hash(password: string): Promise<string> {
    return argon2.hash(password, { ...ARGON2_PARAMS, secret: this.secret });
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password, { secret: this.secret });
    } catch {
      return false;
    }
  }

  /**
   * Burns the same time as a real verification, for unknown or unusable accounts, so response
   * timing does not reveal whether an account exists.
   */
  async verifyDummy(password: string): Promise<false> {
    this.dummyHash ??= this.hash('matilda-timing-equalizer');
    await this.verify(await this.dummyHash, password);
    return false;
  }
}
