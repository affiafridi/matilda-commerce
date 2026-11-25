/** A position in Brand → Market → Branch. A null/undefined dimension means "any" on a grant. */
export interface Scope {
  brandId?: string | null;
  marketId?: string | null;
  branchId?: string | null;
}

/** One active role assignment, flattened to the permissions it carries. */
export interface Grant {
  assignmentId: string;
  roleId: string;
  permissions: ReadonlySet<string>;
  scope: Scope;
}

const DIMENSIONS = ['brandId', 'marketId', 'branchId'] as const;

/**
 * True when `outer` covers `inner`: every dimension the outer scope restricts equals the inner one.
 * Used both to test a grant against a target record and to test whether an actor's grant covers the
 * scope they are trying to hand to someone else (so nobody can grant beyond their own reach).
 * An unrestricted outer covers everything; a restricted outer never covers an unspecified inner.
 */
export function scopeCovers(outer: Scope, inner: Scope): boolean {
  return DIMENSIONS.every((d) => {
    const restriction = outer[d];
    return restriction == null || restriction === inner[d];
  });
}

export const isPlatformScope = (scope: Scope): boolean => DIMENSIONS.every((d) => scope[d] == null);

/** Does any grant give `permission` over the target record's scope? */
export function can(grants: readonly Grant[], permission: string, target: Scope): boolean {
  return grants.some((g) => g.permissions.has(permission) && scopeCovers(g.scope, target));
}

/** Does any grant give `permission` at all (route-level check; data scope is checked per record)? */
export function canAnywhere(grants: readonly Grant[], permission: string): boolean {
  return grants.some((g) => g.permissions.has(permission));
}

/** The scopes in which `permission` is held; used to filter list queries. */
export function scopesFor(grants: readonly Grant[], permission: string): Scope[] {
  return grants.filter((g) => g.permissions.has(permission)).map((g) => g.scope);
}

/**
 * Permissions of `wanted` that the actor cannot hand out at `scope` (escalation check):
 * for each one, some actor grant must hold it AND cover the scope.
 */
export function ungrantable(
  actorGrants: readonly Grant[],
  wanted: readonly string[],
  scope: Scope,
): string[] {
  return wanted.filter((p) => !can(actorGrants, p, scope));
}
