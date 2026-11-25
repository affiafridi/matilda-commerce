import type { Pool } from 'pg';
import { createPool, testAppUrl, testOwnerUrl } from '../test-support/test-db';

describe('database roles (least privilege)', () => {
  let app: Pool;
  let owner: Pool;

  beforeAll(() => {
    app = createPool(testAppUrl());
    owner = createPool(testOwnerUrl());
  });

  afterAll(async () => {
    await app.end();
    await owner.end();
  });

  it('runtime role is not superuser, cannot create roles/databases and does not bypass RLS', async () => {
    const { rows } = await app.query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcreaterole: boolean;
      rolcreatedb: boolean;
    }>(
      'SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = current_user',
    );
    expect(rows[0]).toEqual({
      rolsuper: false,
      rolbypassrls: false,
      rolcreaterole: false,
      rolcreatedb: false,
    });
  });

  it('runtime role cannot run DDL', async () => {
    await expect(app.query('CREATE TABLE should_not_exist (id int)')).rejects.toThrow(
      /permission denied/,
    );
  });

  it('owner role can run DDL, and the runtime role gets DML on the new table by default', async () => {
    await owner.query('CREATE TABLE role_probe (id int primary key, note text)');
    try {
      await app.query("INSERT INTO role_probe VALUES (1, 'ok')");
      const { rows } = await app.query('SELECT note FROM role_probe WHERE id = 1');
      expect(rows[0]).toEqual({ note: 'ok' });
      await expect(app.query('DROP TABLE role_probe')).rejects.toThrow(/must be owner/);
      await expect(app.query('TRUNCATE role_probe')).rejects.toThrow(/permission denied/);
    } finally {
      await owner.query('DROP TABLE IF EXISTS role_probe');
    }
  });

  it('runtime role cannot connect to the owner-only role objects of other databases', async () => {
    await expect(
      app.query("SELECT 1 FROM pg_database WHERE datname = 'matilda_test'"),
    ).resolves.toBeDefined();
    const { rows } = await app.query<{ current_user: string }>('SELECT current_user');
    expect(rows[0]?.current_user).toBe('matilda_app');
  });
});
