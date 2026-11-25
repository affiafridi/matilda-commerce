import { defineConfig } from 'prisma/config';

try {
  process.loadEnvFile('.env');
} catch {
  // .env is optional; variables may come from the real environment.
}

// Prisma CLI (generate/migrate) runs DDL, so it uses the owner role. The running API uses
// DATABASE_URL (matilda_app, DML only) and never has DDL rights.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL ?? '' },
});
