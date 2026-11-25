import type { Prisma, PrismaClient } from '../generated/prisma/client';

/** Tenant context applied to one database transaction (read by the row-level-security policies). */
export interface DbScope {
  /** Brands the caller may see/modify. Empty = none. */
  readonly brandIds: readonly string[];
  /** Platform-wide access (Super Admin / system jobs). Never derived from client input. */
  readonly platform?: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs `fn` in a transaction whose context (`app.brand_ids`, `app.platform`) is set with
 * transaction-local `set_config`, so it can never leak to another request on a pooled connection.
 * Every tenant-data query must go through this helper (docs/MULTI-STORE.md, D2 isolation layers).
 */
export async function withScope<T>(
  client: PrismaClient,
  scope: DbScope,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (const id of scope.brandIds) {
    if (!UUID.test(id)) throw new Error('Invalid brand id in database scope');
  }
  const brandIds = scope.brandIds.join(',');
  const platform = scope.platform ? 'on' : '';
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.brand_ids', ${brandIds}, true), set_config('app.platform', ${platform}, true)`;
    return fn(tx);
  });
}
