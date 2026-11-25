import { type ExecutionContext, ParseUUIDPipe, createParamDecorator } from '@nestjs/common';
import { z } from '@matilda/validation';
import { ApiException } from '../../common/errors/api-exception';
import type { Grant, Scope } from '../iam/authorization/scope';
import { can, canAnywhere, scopeCovers, scopesFor } from '../iam/authorization/scope';
import type { RequestWithAuth } from '../iam/authorization/permissions.guard';

/** The authenticated staff member as the guard resolved them. Services re-check scope per record. */
export interface AdminActor {
  staffId: string;
  sessionId: string;
  grants: readonly Grant[];
}

export const Actor = createParamDecorator((_data: unknown, ctx: ExecutionContext): AdminActor => {
  const req = ctx.switchToHttp().getRequest<RequestWithAuth>();
  if (!req.staffSession) throw new ApiException(401, 'UNAUTHENTICATED', 'Authentication required');
  return {
    staffId: req.staffSession.staffUserId,
    sessionId: req.staffSession.id,
    grants: req.grants ?? [],
  };
});

export const uuidPipe = new ParseUUIDPipe();

export const uuid = z.string().uuid();
export const optionalUuid = uuid.nullish();

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export function paginate<T>(all: readonly T[], page: number, pageSize: number): Page<T> {
  return {
    items: all.slice((page - 1) * pageSize, page * pageSize),
    page,
    pageSize,
    total: all.length,
  };
}

/** Keeps the items whose own scope lies inside a scope the actor holds `permission` over. */
export function visibleTo<T>(
  grants: readonly Grant[],
  permission: string,
  items: readonly T[],
  scopesOf: (item: T) => Scope[],
): T[] {
  const held = scopesFor(grants, permission);
  return items.filter((item) =>
    scopesOf(item).some((target) => held.some((outer) => scopeCovers(outer, target))),
  );
}

export function assertCan(grants: readonly Grant[], permission: string, target: Scope): void {
  if (!can(grants, permission, target)) {
    throw new ApiException(403, 'FORBIDDEN', 'You do not have permission to perform this action');
  }
}

export function assertCanAnywhere(grants: readonly Grant[], permission: string): void {
  if (!canAnywhere(grants, permission)) {
    throw new ApiException(403, 'FORBIDDEN', 'You do not have permission to perform this action');
  }
}

export const notFound = (what: string) =>
  new ApiException(
    404,
    `${what.toUpperCase().replace(/\s+/g, '_')}_NOT_FOUND`,
    `${what} not found`,
  );

/** Prisma unique-constraint violation (P2002), including through the driver adapter. */
export function isUniqueViolation(err: unknown): boolean {
  const text = err instanceof Error ? `${err.message} ${String(err.cause ?? '')}` : '';
  return /P2002|unique constraint|duplicate key/i.test(text);
}
