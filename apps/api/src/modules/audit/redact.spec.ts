import { maskEmail, redact } from './redact';

describe('audit redaction', () => {
  it('replaces secrets by key name, at any depth', () => {
    const out = redact({
      passwordHash: 'argon2id$abc',
      password: 'hunter2',
      nested: { sessionToken: 't0k3n', totpSecret: 'JBSWY3DP', apiKey: 'sk_live_1' },
      list: [{ recoveryCodes: ['a', 'b'], authorization: 'Bearer x' }],
      cookie: 'sid=1',
      keep: 'visible',
    });
    expect(JSON.stringify(out)).not.toMatch(/hunter2|argon2id|t0k3n|JBSWY3DP|sk_live|Bearer|sid=1/);
    expect(out).toMatchObject({ keep: 'visible', password: '[REDACTED]' });
  });

  it('masks email addresses wherever they appear', () => {
    expect(maskEmail('jane.doe@example.com')).toBe('j***@example.com');
    const out = redact({ email: 'jane.doe@example.com', note: 'plain text' }) as Record<
      string,
      string
    >;
    expect(out.email).toBe('j***@example.com');
    expect(out.note).toBe('plain text');
  });

  it('keeps ordinary business fields such as codes and ids', () => {
    expect(redact({ code: 'ae', marketId: 'm1', count: 3, active: true })).toEqual({
      code: 'ae',
      marketId: 'm1',
      count: 3,
      active: true,
    });
  });

  it('bounds size and depth, and never mutates its input', () => {
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let i = 0; i < 20; i++) {
      const next: Record<string, unknown> = {};
      cursor.child = next;
      cursor = next;
    }
    expect(JSON.stringify(redact(deep))).toContain('[TRUNCATED]');
    expect((redact(Array.from({ length: 500 }, (_, i) => i)) as unknown[]).length).toBe(50);
    expect((redact('x'.repeat(5000)) as string).length).toBeLessThan(600);

    const input = { password: 'p', when: new Date('2026-01-01T00:00:00Z'), big: 10n };
    const out = redact(input) as Record<string, unknown>;
    expect(input.password).toBe('p');
    expect(out.when).toBe('2026-01-01T00:00:00.000Z');
    expect(out.big).toBe('10');
  });
});
