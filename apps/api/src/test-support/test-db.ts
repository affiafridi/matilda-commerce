import { type Pool, Pool as PgPool, type PoolConfig } from 'pg';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Copy apps/api/.env.example to .env and run \`pnpm docker:up\`.`,
    );
  }
  return value;
}

/** Runtime role (matilda_app) connection string for the test database. */
export const testAppUrl = (): string => required('TEST_DATABASE_URL');

/** Owner role (matilda_owner) connection string for the test database (DDL). */
export const testOwnerUrl = (): string => required('TEST_MIGRATION_DATABASE_URL');

export function createPool(connectionString: string, config: PoolConfig = {}): Pool {
  return new PgPool({ connectionString, max: 4, ...config });
}

/**
 * Empties `audit_log` for tests. The table is append-only for everyone (trigger), so the owner
 * disables the user triggers for the duration of the truncate. Never use outside the test database.
 */
export async function resetAuditLog(ownerPool: Pool): Promise<void> {
  const client = await ownerPool.connect();
  try {
    await client.query('ALTER TABLE audit_log DISABLE TRIGGER USER');
    await client.query('TRUNCATE audit_log RESTART IDENTITY');
    await client.query('ALTER TABLE audit_log ENABLE TRIGGER USER');
  } finally {
    client.release();
  }
}
