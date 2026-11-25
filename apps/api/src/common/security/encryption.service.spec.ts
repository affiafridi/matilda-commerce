import { randomBytes } from 'node:crypto';
import { loadEnv } from '../../config/env';
import { EncryptionService } from './encryption.service';

const key = (): string => randomBytes(32).toString('base64');

function service(keys: string, active: string): EncryptionService {
  return new EncryptionService(
    loadEnv({ APP_ENCRYPTION_KEYS: keys, APP_ENCRYPTION_ACTIVE_KEY: active }),
  );
}

describe('EncryptionService', () => {
  it('round-trips and never stores plaintext', () => {
    const svc = service(`1:${key()}`, '1');
    const payload = svc.encrypt('JBSWY3DPEHPK3PXP');
    expect(payload).not.toContain('JBSWY3DPEHPK3PXP');
    expect(payload.startsWith('v1.')).toBe(true);
    expect(svc.decrypt(payload)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('uses a fresh IV for each encryption', () => {
    const svc = service(`1:${key()}`, '1');
    expect(svc.encrypt('same')).not.toBe(svc.encrypt('same'));
  });

  it('detects tampering', () => {
    const svc = service(`1:${key()}`, '1');
    const parts = svc.encrypt('secret').split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => svc.decrypt(parts.join('.'))).toThrow();
  });

  it('binds ciphertext to its AAD context', () => {
    const svc = service(`1:${key()}`, '1');
    const payload = svc.encrypt('secret', 'staff:1');
    expect(svc.decrypt(payload, 'staff:1')).toBe('secret');
    expect(() => svc.decrypt(payload, 'staff:2')).toThrow();
  });

  it('supports key rotation', () => {
    const k1 = key();
    const old = service(`1:${k1}`, '1').encrypt('secret');
    const rotated = service(`1:${k1},2:${key()}`, '2');
    expect(rotated.decrypt(old)).toBe('secret');
    expect(rotated.needsRotation(old)).toBe(true);
    expect(rotated.needsRotation(rotated.encrypt('x'))).toBe(false);
  });

  it('fails clearly when no key is configured', () => {
    const svc = new EncryptionService(loadEnv({}));
    expect(() => svc.encrypt('x')).toThrow(/not configured/);
  });
});
