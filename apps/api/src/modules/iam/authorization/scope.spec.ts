import { can, canAnywhere, isPlatformScope, scopeCovers, scopesFor, ungrantable } from './scope';
import type { Grant, Scope } from './scope';

const A = 'brand-a';
const B = 'brand-b';
const MA = 'market-a'; // belongs to brand A
const MB = 'market-b'; // belongs to brand B
const X = 'branch-x'; // serves market A
const Y = 'branch-y'; // serves market B

const grant = (permissions: string[], scope: Scope): Grant => ({
  assignmentId: 'g',
  roleId: 'r',
  permissions: new Set(permissions),
  scope,
});

const SCOPES = {
  platform: {},
  brandA: { brandId: A },
  marketA: { brandId: A, marketId: MA },
  branchX: { branchId: X },
  brandAbranchX: { brandId: A, branchId: X },
} satisfies Record<string, Scope>;

const TARGETS = {
  platform: {},
  brandA: { brandId: A },
  brandB: { brandId: B },
  marketA: { brandId: A, marketId: MA },
  marketB: { brandId: B, marketId: MB },
  branchXinA: { brandId: A, marketId: MA, branchId: X },
  branchYinB: { brandId: B, marketId: MB, branchId: Y },
} satisfies Record<string, Scope>;

type G = keyof typeof SCOPES;
type T = keyof typeof TARGETS;

/** Expected allowed targets per grant scope: the permission x scope matrix. */
const EXPECTED: Record<G, T[]> = {
  platform: ['platform', 'brandA', 'brandB', 'marketA', 'marketB', 'branchXinA', 'branchYinB'],
  brandA: ['brandA', 'marketA', 'branchXinA'],
  marketA: ['marketA', 'branchXinA'],
  branchX: ['branchXinA'],
  brandAbranchX: ['branchXinA'],
};

describe('authorization matrix (permission x scope)', () => {
  for (const g of Object.keys(SCOPES) as G[]) {
    for (const t of Object.keys(TARGETS) as T[]) {
      const allowed = EXPECTED[g].includes(t);
      it(`grant at ${g} ${allowed ? 'allows' : 'denies'} target ${t}`, () => {
        const grants = [grant(['orders.view'], SCOPES[g])];
        expect(can(grants, 'orders.view', TARGETS[t])).toBe(allowed);
      });
    }
  }

  it('denies a permission the grants do not carry, in every scope', () => {
    const grants = [grant(['orders.view'], {})];
    for (const t of Object.keys(TARGETS) as T[]) {
      expect(can(grants, 'orders.cancel', TARGETS[t])).toBe(false);
    }
  });

  it('denies everything without grants', () => {
    expect(can([], 'orders.view', {})).toBe(false);
    expect(canAnywhere([], 'orders.view')).toBe(false);
  });

  it('unions several grants and never mixes permissions across scopes', () => {
    const grants = [
      grant(['orders.view'], { brandId: A }),
      grant(['orders.cancel'], { brandId: B }),
    ];
    expect(can(grants, 'orders.view', TARGETS.marketA)).toBe(true);
    expect(can(grants, 'orders.cancel', TARGETS.marketA)).toBe(false);
    expect(can(grants, 'orders.cancel', TARGETS.marketB)).toBe(true);
    expect(can(grants, 'orders.view', TARGETS.marketB)).toBe(false);
  });

  it('reports where a permission is held', () => {
    const grants = [grant(['orders.view'], { brandId: A }), grant(['x.y'], {})];
    expect(scopesFor(grants, 'orders.view')).toEqual([{ brandId: A }]);
    expect(canAnywhere(grants, 'orders.view')).toBe(true);
    expect(isPlatformScope({})).toBe(true);
    expect(isPlatformScope({ brandId: A })).toBe(false);
  });
});

describe('escalation (ungrantable)', () => {
  const actor = [grant(['orders.view', 'orders.edit', 'users.manage'], { brandId: A })];

  it('allows handing out what the actor holds, inside their own scope', () => {
    expect(ungrantable(actor, ['orders.view'], { brandId: A, marketId: MA })).toEqual([]);
  });

  it('blocks permissions the actor does not hold', () => {
    expect(ungrantable(actor, ['orders.view', 'refunds.approve'], { brandId: A })).toEqual([
      'refunds.approve',
    ]);
  });

  it('blocks handing out a wider scope than the actor has', () => {
    expect(ungrantable(actor, ['orders.view'], {})).toEqual(['orders.view']);
    expect(ungrantable(actor, ['orders.view'], { brandId: B })).toEqual(['orders.view']);
    expect(scopeCovers({ brandId: A }, { brandId: A, branchId: X })).toBe(true);
    expect(scopeCovers({ brandId: A }, {})).toBe(false);
  });
});
