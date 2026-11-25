import { z } from '@matilda/validation';

const booleanFlag = z.enum(['true', 'false']).transform((v) => v === 'true');

/** `1:<base64 32-byte key>,2:<base64 32-byte key>` (key ring; see EncryptionService). */
const encryptionKeys = z
  .string()
  .min(1)
  .transform((raw, ctx) => {
    const ring: Record<number, string> = {};
    for (const part of raw.split(',')) {
      const [version, key] = part.trim().split(':');
      const v = Number(version);
      if (!Number.isInteger(v) || v < 1 || !key || Buffer.from(key, 'base64').length !== 32) {
        ctx.addIssue({
          code: 'custom',
          message: 'Expected "<version>:<base64 32-byte key>" entries separated by commas',
        });
        return z.NEVER;
      }
      ring[v] = key;
    }
    return ring;
  });

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:3000,http://localhost:3001')
      .transform((v) =>
        v
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),
      ),
    SWAGGER_ENABLED: booleanFlag.optional(),
    // Runtime database role (matilda_app): DML only, subject to row-level security.
    DATABASE_URL: z.string().min(1).optional(),
    REDIS_URL: z.string().min(1).optional(),
    // Key ring for encrypting secrets at rest (TOTP secrets, later payment credentials).
    APP_ENCRYPTION_KEYS: encryptionKeys.optional(),
    APP_ENCRYPTION_ACTIVE_KEY: z.coerce.number().int().min(1).optional(),
    // Shared secret that authenticates the Next.js servers when they forward the real host
    // header to the API (docs/PHASE-2-PLAN.md D2-02).
    TRUSTED_PROXY_SECRET: z.string().min(32).optional(),
    // Optional server-side pepper mixed into every password hash (Argon2 `secret`). Changing it
    // invalidates all existing passwords, so set it once before the first real account exists.
    PASSWORD_PEPPER: z.string().min(32).optional(),
    // Public base URL of the admin app, used in invite and reset links.
    ADMIN_BASE_URL: z.url().default('http://localhost:3001'),
  })
  .superRefine((env, ctx) => {
    const strict = env.NODE_ENV === 'staging' || env.NODE_ENV === 'production';
    if (strict) {
      for (const key of [
        'DATABASE_URL',
        'APP_ENCRYPTION_KEYS',
        'APP_ENCRYPTION_ACTIVE_KEY',
        'TRUSTED_PROXY_SECRET',
        'PASSWORD_PEPPER',
      ] as const) {
        if (env[key] === undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `Required when NODE_ENV=${env.NODE_ENV}`,
          });
        }
      }
    }
    if (
      env.APP_ENCRYPTION_KEYS &&
      env.APP_ENCRYPTION_ACTIVE_KEY !== undefined &&
      !(env.APP_ENCRYPTION_ACTIVE_KEY in env.APP_ENCRYPTION_KEYS)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['APP_ENCRYPTION_ACTIVE_KEY'],
        message: 'Active key version is not present in APP_ENCRYPTION_KEYS',
      });
    }
  });

export type Env = Omit<z.infer<typeof envSchema>, 'SWAGGER_ENABLED'> & { SWAGGER_ENABLED: boolean };

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  const data = parsed.data;
  return { ...data, SWAGGER_ENABLED: data.SWAGGER_ENABLED ?? data.NODE_ENV !== 'production' };
}

export const APP_ENV = Symbol('APP_ENV');
