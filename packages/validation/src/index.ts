import { z } from 'zod';

export const nodeEnvSchema = z.enum(['development', 'test', 'staging', 'production']);

/** Pagination query contract shared by all list endpoints (docs/API.md). */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export * from './catalog.ts';
export * from './commerce.ts';
export * from './delivery.ts';
export * from './inventory.ts';
export { z };
export type { ZodType } from 'zod';
