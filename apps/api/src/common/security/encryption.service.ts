import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { APP_ENV, type Env } from '../../config/env';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

/**
 * AES-256-GCM envelope for secrets at rest (TOTP secrets, later payment credentials).
 * Format: `v<keyVersion>.<iv>.<authTag>.<ciphertext>` (base64url). The key ring allows rotation:
 * new data uses the active key, old data stays readable until re-encrypted.
 * The optional `aad` binds a ciphertext to its context (e.g. the owning row id).
 */
@Injectable()
export class EncryptionService {
  constructor(@Inject(APP_ENV) private readonly env: Env) {}

  encrypt(plaintext: string, aad?: string): string {
    const { version, key } = this.activeKey();
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [`v${version}`, iv, tag, ciphertext]
      .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
      .join('.');
  }

  decrypt(payload: string, aad?: string): string {
    const [versionPart, ivPart, tagPart, dataPart] = payload.split('.');
    if (!versionPart?.startsWith('v') || !ivPart || !tagPart || !dataPart) {
      throw new Error('Malformed encrypted payload');
    }
    const key = this.keyFor(Number(versionPart.slice(1)));
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivPart, 'base64url'));
    if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  /** True when the payload was written with a key that is no longer the active one. */
  needsRotation(payload: string): boolean {
    return payload.split('.')[0] !== `v${this.activeKey().version}`;
  }

  private activeKey(): { version: number; key: Buffer } {
    const version = this.env.APP_ENCRYPTION_ACTIVE_KEY;
    if (version === undefined) throw new Error('APP_ENCRYPTION_ACTIVE_KEY is not configured');
    return { version, key: this.keyFor(version) };
  }

  private keyFor(version: number): Buffer {
    const encoded = this.env.APP_ENCRYPTION_KEYS?.[version];
    if (!encoded) throw new Error(`Encryption key version ${version} is not configured`);
    return Buffer.from(encoded, 'base64');
  }
}
