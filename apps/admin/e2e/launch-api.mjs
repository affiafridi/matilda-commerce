// Starts the API for the end-to-end run against the TEST database on port 4100.
//  - applies migrations and the dev seed tier (idempotent)
//  - captures the console mail adapter's messages (invite links) into e2e/.tmp/outbox.jsonl, the way
//    a real mailbox would be read by a person
// Never points at the development database: it refuses to start without TEST_DATABASE_URL.
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = resolve(here, '../../api');
const tmp = join(here, '.tmp');
const outbox = join(tmp, 'outbox.jsonl');

process.loadEnvFile(join(apiDir, '.env'));
const testUrl = process.env.TEST_DATABASE_URL;
const testOwnerUrl = process.env.TEST_MIGRATION_DATABASE_URL;
if (!testUrl || !testOwnerUrl) {
  console.error('TEST_DATABASE_URL and TEST_MIGRATION_DATABASE_URL must be set in apps/api/.env');
  process.exit(1);
}

mkdirSync(tmp, { recursive: true });
rmSync(outbox, { force: true });

const env = {
  ...process.env,
  NODE_ENV: 'test',
  LOG_LEVEL: 'info',
  PORT: '4100',
  DATABASE_URL: testUrl,
  MIGRATION_DATABASE_URL: testOwnerUrl,
  CORS_ORIGINS: 'http://localhost:3101',
  ADMIN_BASE_URL: 'http://localhost:3101',
  SWAGGER_ENABLED: 'false',
};

const require = createRequire(join(apiDir, 'package.json'));
execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
  cwd: apiDir,
  env,
  stdio: 'inherit',
});
execFileSync(process.execPath, [join(apiDir, 'dist/cli/seed.js'), 'dev'], {
  cwd: apiDir,
  env,
  stdio: 'inherit',
});

const api = spawn(process.execPath, [join(apiDir, 'dist/main.js')], {
  cwd: apiDir,
  env,
  stdio: ['ignore', 'pipe', 'inherit'],
});

let buffer = '';
api.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    try {
      const entry = JSON.parse(line);
      if (entry.mail) appendFileSync(outbox, `${JSON.stringify(entry.mail)}\n`);
    } catch {
      // Not a JSON log line.
    }
  }
});
api.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => api.kill(signal));
