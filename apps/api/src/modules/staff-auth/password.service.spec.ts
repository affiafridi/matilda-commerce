import { PasswordService, passwordProblems } from './password.service';
import type { Env } from '../../config/env';

const service = (pepper?: string) =>
  new PasswordService({ PASSWORD_PEPPER: pepper } as unknown as Env);

describe('passwordProblems', () => {
  it('rejects short, common, low-variety and email-derived passwords', () => {
    expect(passwordProblems('short')).not.toEqual([]);
    expect(passwordProblems('Password12345!')).toContain('This password is too common.');
    expect(passwordProblems('aaaaaaaaaaaaaaaa')).toContain('Use a greater variety of characters.');
    expect(passwordProblems('janedoe-is-here-1', { email: 'janedoe@example.test' })).toContain(
      'The password must not contain your email name.',
    );
  });

  it('accepts a long passphrase', () => {
    expect(passwordProblems('correct horse battery staple')).toEqual([]);
  });

  it('enforces an upper bound to protect the hasher', () => {
    expect(passwordProblems('x1'.repeat(70)).length).toBeGreaterThan(0);
  });
});

describe('PasswordService', () => {
  it('hashes with Argon2id at the documented parameters', async () => {
    const hash = await service().hash('correct horse battery staple');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it('verifies the right password only, and never throws on garbage hashes', async () => {
    const s = service();
    const hash = await s.hash('correct horse battery staple');
    await expect(s.verify(hash, 'correct horse battery staple')).resolves.toBe(true);
    await expect(s.verify(hash, 'wrong horse battery staple')).resolves.toBe(false);
    await expect(s.verify('not-a-hash', 'x')).resolves.toBe(false);
  });

  it('binds hashes to the pepper', async () => {
    const pepper = 'p'.repeat(32);
    const hash = await service(pepper).hash('correct horse battery staple');
    await expect(service(pepper).verify(hash, 'correct horse battery staple')).resolves.toBe(true);
    await expect(service().verify(hash, 'correct horse battery staple')).resolves.toBe(false);
    await expect(
      service('q'.repeat(32)).verify(hash, 'correct horse battery staple'),
    ).resolves.toBe(false);
  });

  it('uses unique salts', async () => {
    const s = service();
    expect(await s.hash('same password here')).not.toBe(await s.hash('same password here'));
  });
});
