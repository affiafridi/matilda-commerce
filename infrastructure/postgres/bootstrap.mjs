// Applies infrastructure/postgres/bootstrap.sql to the local Docker PostgreSQL container.
// Usage: node infrastructure/postgres/bootstrap.mjs   (or `pnpm db:bootstrap`)
// Local development only. Refuses to run when NODE_ENV is production.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

if (process.env.NODE_ENV === 'production') {
  console.error('db:bootstrap is for local development only.');
  process.exit(1);
}

const container = process.env.POSTGRES_CONTAINER ?? 'matilda-postgres';
const superUser = process.env.POSTGRES_USER ?? 'matilda';
const ownerPw = process.env.MATILDA_OWNER_PASSWORD ?? 'matilda_owner_dev_password';
const appPw = process.env.MATILDA_APP_PASSWORD ?? 'matilda_app_dev_password';

const sql = readFileSync(fileURLToPath(new URL('./bootstrap.sql', import.meta.url)), 'utf8');

const result = spawnSync(
  'docker',
  [
    'exec',
    '-i',
    container,
    'psql',
    '-U',
    superUser,
    '-d',
    'postgres',
    '-v',
    `owner_pw=${ownerPw}`,
    '-v',
    `app_pw=${appPw}`,
    '-v',
    'ON_ERROR_STOP=1',
    '-q',
  ],
  { input: sql, stdio: ['pipe', 'inherit', 'inherit'] },
);

if (result.status !== 0) {
  console.error('Bootstrap failed. Is the container running? Try: pnpm docker:up');
  process.exit(result.status ?? 1);
}
process.stdout.write(
  'Database roles and test database are ready (matilda_owner, matilda_app, matilda_test).\n',
);
