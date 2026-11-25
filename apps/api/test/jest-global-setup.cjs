// Applies all migrations to the test database (as the owner role) before DB integration tests.
const { execFileSync } = require('node:child_process');

module.exports = async () => {
  const url = process.env.TEST_MIGRATION_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_MIGRATION_DATABASE_URL is not set. Run `pnpm docker:up` and fill apps/api/.env.',
    );
  }
  const prismaCli = require.resolve('prisma/build/index.js');
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: process.cwd(),
    env: { ...process.env, MIGRATION_DATABASE_URL: url },
    stdio: 'pipe',
  });
};
