import { z } from '@matilda/validation';

const booleanFlag = z.enum(['true', 'false']).transform((v) => v === 'true');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
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
  // Optional in Phase 1 so the API can boot without a database; readiness reports its state.
  DATABASE_URL: z.string().min(1).optional(),
  REDIS_URL: z.string().min(1).optional(),
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
