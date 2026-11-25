import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { ROLE_TEMPLATES } from './permissions/role-templates';

/**
 * Authorization is by permission, never by role name (CLAUDE.md rule 2). The only files allowed to
 * mention system role keys or names are the template definitions themselves.
 */
const SRC = join(__dirname, '..', '..');
const ALLOWED = new Set(['modules/iam/permissions/role-templates.ts']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return entry === 'generated' ? [] : sourceFiles(full);
    return full.endsWith('.ts') && !/\.(spec|e2e-spec|int-spec)\.ts$/.test(full) ? [full] : [];
  });
}

describe('role names in source code', () => {
  const files = sourceFiles(SRC).filter((f) => !ALLOWED.has(relative(SRC, f).split(sep).join('/')));

  it('never reference a system role key or name', () => {
    const needles = ROLE_TEMPLATES.flatMap((t) => [
      `'${t.systemKey}'`,
      `'${t.name}'`,
      `"${t.name}"`,
    ]);
    const offenders = files.flatMap((f) => {
      const text = readFileSync(f, 'utf8');
      return needles.filter((n) => text.includes(n)).map((n) => `${relative(SRC, f)}: ${n}`);
    });
    expect(offenders).toEqual([]);
  });

  it('never compare against a role name property', () => {
    const offenders = files.filter((f) =>
      /(role|Role)\.(name|systemKey)\s*(===|!==|==|!=)/.test(readFileSync(f, 'utf8')),
    );
    expect(offenders.map((f) => relative(SRC, f))).toEqual([]);
  });
});
