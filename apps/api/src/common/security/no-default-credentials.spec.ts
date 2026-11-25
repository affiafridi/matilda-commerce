import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * Acceptance criterion of step 2.6: no default credentials, seeded passwords or committed secrets.
 * This scans tracked source and config for the usual offenders; tests and docs are excluded because
 * they legitimately contain example values.
 */
const ROOT = resolve(__dirname, '../../../../..');
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'generated',
  'coverage',
  'docs',
  '.claude',
]);
const SKIP_FILES = /(\.spec\.ts|\.e2e-spec\.ts|\.int-spec\.ts|pnpm-lock\.yaml|\.md)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|mjs|cjs|json|ya?ml|sql|prisma|env\.example)$|\.env/.test(name)) {
      if (!SKIP_FILES.test(name) && name !== '.env') out.push(full);
    }
  }
  return out;
}

const FORBIDDEN: [string, RegExp][] = [
  ['default admin account', /\b(admin|superadmin|root)@(example|matilda)[\w.-]*/i],
  ['well-known password', /\b(password123|admin123|changeme|letmein|p@ssw0rd|qwerty123)\b/i],
  [
    'literal password assignment',
    /\b(password|passwd|secret|apiKey)\s*[:=]\s*['"][^'"\s]{6,}['"]/i,
  ],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['live payment key', /\b(sk_live|rk_live|pk_live)_[A-Za-z0-9]+/],
];

describe('repository scan', () => {
  const files = walk(ROOT);

  it('finds source files to scan', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(FORBIDDEN)('contains no %s', (_label, pattern) => {
    const hits = files
      .filter((f) => pattern.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f));
    expect(hits).toEqual([]);
  });
});
