import { generateSync } from 'otplib';
import { TotpService } from './totp.service';

describe('TotpService', () => {
  const totp = new TotpService();

  it('accepts the current code and reports its time step', () => {
    const secret = totp.generateSecret();
    const step = totp.verify(secret, generateSync({ secret }));
    expect(step).toEqual(expect.any(Number));
    expect(step).toBeCloseTo(Date.now() / 30_000, -1);
  });

  it('rejects wrong and malformed codes', () => {
    const secret = totp.generateSecret();
    const valid = generateSync({ secret });
    const wrong = valid === '000000' ? '000001' : '000000';
    expect(totp.verify(secret, wrong)).toBeNull();
    for (const bad of ['', '12345', '1234567', 'abcdef', ' 123456'])
      expect(totp.verify(secret, bad)).toBeNull();
  });

  it('tolerates one step of clock drift but not more', () => {
    const secret = totp.generateSecret();
    const now = Date.now() / 1000;
    const at = (offset: number) => generateSync({ secret, epoch: now + offset });
    expect(totp.verify(secret, at(-30))).not.toBeNull();
    expect(totp.verify(secret, at(-120))).toBeNull();
    expect(totp.verify(secret, at(120))).toBeNull();
  });

  it('builds an otpauth URI naming the issuer and account', () => {
    const uri = totp.otpauthUri('a@example.test', 'JBSWY3DPEHPK3PXP');
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain('issuer=Matilda');
    expect(decodeURIComponent(uri)).toContain('a@example.test');
  });
});
