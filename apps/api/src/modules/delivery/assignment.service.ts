import { Injectable } from '@nestjs/common';
import { z } from '@matilda/validation';
import { ApiException } from '../../common/errors/api-exception';
import type { AssignmentRuleKind } from '../../generated/prisma/client';
import { type AdminActor, notFound, uuid } from '../admin/admin-common';
import type { Tx } from '../admin/brand-access';
import {
  type AvailabilityInput,
  type AvailabilityResult,
  AvailabilityService,
  availabilityBody,
} from '../availability/availability.service';
import { can } from '../iam/authorization/scope';
import { DeliveryAccess } from './delivery-common';

const RULE_KINDS = [
  'COVERS_AREA',
  'HAS_STOCK',
  'OPEN_IN_TIME',
  'PRIORITY',
  'CLOSEST',
  'LEAST_LOADED',
] as const satisfies readonly AssignmentRuleKind[];

/** Rules that only rank branches; the other three describe what availability always requires. */
const RANKING: ReadonlySet<AssignmentRuleKind> = new Set(['PRIORITY', 'CLOSEST', 'LEAST_LOADED']);

export const assignmentRuleListQuery = z.object({ marketId: uuid });

export const putAssignmentRulesBody = z.object({
  marketId: uuid,
  rules: z
    .array(
      z.object({
        kind: z.enum(RULE_KINDS),
        status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
      }),
    )
    .max(RULE_KINDS.length)
    .refine((r) => new Set(r.map((x) => x.kind)).size === r.length, {
      message: 'Each rule can appear only once',
    }),
});

const location = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

/** What staff test, and what the order flow (Phases 5 and 6) will pass to the same functions. */
export const assignmentContextBody = z.object({
  marketId: uuid,
  areaId: uuid,
  lines: availabilityBody.shape.lines,
  /** The delivery day, market-local (`YYYY-MM-DD`). */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date as YYYY-MM-DD'),
  /** The slot the shopper holds; it belongs to one branch, which then has to be the chosen one. */
  slotId: uuid.optional(),
  /** Where the customer is, for the "closest" rule. Without it that rule is skipped. */
  location: location.optional(),
});

export const assignmentPreviewBody = assignmentContextBody.extend({
  /** A branch staff want to check by hand. */
  branchId: uuid.optional(),
});

export const assignmentOverrideBody = assignmentContextBody.extend({
  branchId: uuid,
  /** What the change is for (an order number once orders exist). */
  reference: z.string().trim().min(1).max(120).optional(),
  reason: z.string().trim().min(3).max(500),
});

export const availabilityTestBody = z.object({
  marketId: uuid,
  areaId: uuid,
  lines: availabilityBody.shape.lines,
  from: availabilityBody.shape.from,
  days: availabilityBody.shape.days,
});

type Context = z.infer<typeof assignmentContextBody>;

export interface RankedBranch {
  branchId: string;
  /** Lower comes first; from the serving list of the zone. */
  priority: number;
  /** Places already taken on that day across the branch's slots. */
  loadBooked: number;
  /** Straight-line distance in metres, when both sides have coordinates. */
  distanceMeters: number | null;
}

/** Straight-line distance between two points on the earth, in metres. */
export function distanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h))));
}

/**
 * Branch assignment (Phase 4 step 4.11, D4-12). Which branches may serve a delivery is decided by
 * the availability service (zone coverage, stock, opening hours, closures, slot places), so a branch
 * that cannot serve is never assigned whatever the rules say. The ordered rules of the market only
 * decide the preference among branches that can: priority of the zone's serving list, closest to
 * the customer (needs coordinates, no maps provider), fewest places taken that day. With no rules
 * configured the serving-list priority is used. A manual choice is checked against the same
 * eligible set and audited.
 */
@Injectable()
export class AssignmentService {
  constructor(
    private readonly access: DeliveryAccess,
    private readonly availability: AvailabilityService,
  ) {}

  private view(r: { id: string; kind: AssignmentRuleKind; position: number; status: string }) {
    return {
      id: r.id,
      kind: r.kind,
      position: r.position,
      status: r.status,
      ranks: RANKING.has(r.kind),
    };
  }

  private can(actor: AdminActor, permission: string, brandId: string, marketId: string): void {
    if (!can(actor.grants, permission, { brandId, marketId })) {
      throw new ApiException(403, 'FORBIDDEN', 'You do not have permission to perform this action');
    }
  }

  async listRules(actor: AdminActor, brandId: string, marketId: string) {
    return this.access.runAt(actor, { brandId, marketId }, ['delivery.view'], async (tx) => {
      await this.market(tx, brandId, marketId);
      const rows = await tx.branchAssignmentRule.findMany({
        where: { marketId },
        orderBy: { position: 'asc' },
      });
      return { marketId, rules: rows.map((r) => this.view(r)) };
    });
  }

  private async market(tx: Tx, brandId: string, marketId: string) {
    const market = await tx.market.findFirst({ where: { id: marketId, brandId } });
    if (!market) throw notFound('Market');
    return market;
  }

  /** Replaces the whole ordered list of the market. */
  async putRules(actor: AdminActor, brandId: string, body: z.infer<typeof putAssignmentRulesBody>) {
    return this.access.runAt(
      actor,
      { brandId, marketId: body.marketId },
      ['delivery.manage'],
      async (tx) => {
        await this.market(tx, brandId, body.marketId);
        const before = await tx.branchAssignmentRule.findMany({
          where: { marketId: body.marketId },
          orderBy: { position: 'asc' },
        });
        await tx.branchAssignmentRule.deleteMany({ where: { marketId: body.marketId } });
        await tx.branchAssignmentRule.createMany({
          data: body.rules.map((r, position) => ({
            brandId,
            marketId: body.marketId,
            kind: r.kind,
            status: r.status,
            position,
          })),
        });
        const rows = await tx.branchAssignmentRule.findMany({
          where: { marketId: body.marketId },
          orderBy: { position: 'asc' },
        });
        const out = { marketId: body.marketId, rules: rows.map((r) => this.view(r)) };
        await this.access.recordFor(tx, actor, {
          brandId,
          marketId: body.marketId,
          action: 'delivery.assignment_rules.put',
          targetType: 'market',
          targetId: body.marketId,
          before: before.map((r) => ({ kind: r.kind, status: r.status })),
          after: out.rules.map((r) => ({ kind: r.kind, status: r.status })),
        });
        return out;
      },
    );
  }

  /** The availability tester: the full internal answer, including which branch serves each slot. */
  async testAvailability(
    actor: AdminActor,
    brandId: string,
    body: z.infer<typeof availabilityTestBody>,
    now = new Date(),
  ): Promise<AvailabilityResult> {
    this.access.assertReaches(actor, brandId, ['delivery.view']);
    this.can(actor, 'delivery.view', brandId, body.marketId);
    const input: AvailabilityInput = {
      areaId: body.areaId,
      lines: body.lines,
      days: body.days,
      ...(body.from && { from: body.from }),
    };
    return this.availability.evaluate(brandId, body.marketId, input, now);
  }

  /** Branches that can deliver on the day (and, when a slot is held, that slot's own branch). */
  private async candidates(brandId: string, ctx: Context, now: Date) {
    const result = await this.availability.evaluate(
      brandId,
      ctx.marketId,
      { areaId: ctx.areaId, lines: ctx.lines, from: ctx.date, days: 1 },
      now,
    );
    const day = result.dates.find((d) => d.date === ctx.date);
    const slots = (day?.slots ?? []).filter((s) => !ctx.slotId || s.slotId === ctx.slotId);
    if (ctx.slotId && slots.length === 0) {
      throw new ApiException(
        409,
        'SLOT_UNAVAILABLE',
        'That slot cannot be delivered for this cart',
      );
    }
    return {
      zoneId: result.zoneId,
      reason: result.reason,
      branchIds: [...new Set(slots.map((s) => s.branchId))],
    };
  }

  private async rank(
    brandId: string,
    ctx: Context,
    zoneId: string | null,
    branchIds: readonly string[],
  ): Promise<{ ranking: RankedBranch[]; rules: AssignmentRuleKind[] }> {
    return this.access.runPublic(brandId, async (tx) => {
      const rules = (
        await tx.branchAssignmentRule.findMany({
          where: { marketId: ctx.marketId, status: 'ACTIVE' },
          orderBy: { position: 'asc' },
        })
      )
        .map((r) => r.kind)
        .filter((k) => RANKING.has(k));
      const order: AssignmentRuleKind[] = rules.length ? rules : ['PRIORITY'];
      const serving = zoneId
        ? await tx.branchZone.findMany({ where: { zoneId, branchId: { in: [...branchIds] } } })
        : [];
      const branches = await tx.branch.findMany({ where: { id: { in: [...branchIds] } } });
      const slots = await tx.deliverySlot.findMany({
        where: { marketId: ctx.marketId, branchId: { in: [...branchIds] } },
        select: { id: true, branchId: true },
      });
      const booked = slots.length
        ? await tx.slotDay.findMany({
            where: {
              slotId: { in: slots.map((s) => s.id) },
              deliveryDate: new Date(`${ctx.date}T00:00:00.000Z`),
            },
          })
        : [];
      const ranking: RankedBranch[] = branchIds.map((branchId) => {
        const b = branches.find((x) => x.id === branchId);
        const here =
          b?.latitude != null && b.longitude != null && ctx.location
            ? distanceMeters(ctx.location, {
                latitude: Number(b.latitude),
                longitude: Number(b.longitude),
              })
            : null;
        return {
          branchId,
          priority: serving.find((s) => s.branchId === branchId)?.priority ?? 0,
          loadBooked: booked
            .filter((d) => slots.some((s) => s.id === d.slotId && s.branchId === branchId))
            .reduce((sum, d) => sum + d.booked, 0),
          distanceMeters: here,
        };
      });
      const keyOf = (r: RankedBranch, kind: AssignmentRuleKind): number =>
        kind === 'PRIORITY'
          ? r.priority
          : kind === 'LEAST_LOADED'
            ? r.loadBooked
            : (r.distanceMeters ?? Number.MAX_SAFE_INTEGER);
      ranking.sort((a, b) => {
        for (const kind of order) {
          const d = keyOf(a, kind) - keyOf(b, kind);
          if (d !== 0) return d;
        }
        return a.branchId.localeCompare(b.branchId);
      });
      return { ranking, rules: order };
    });
  }

  /**
   * The branch to use: the one behind the held slot, otherwise the best ranked of the branches
   * that can deliver on the day. Throws 409 `NO_ELIGIBLE_BRANCH` when none can.
   */
  async choose(brandId: string, ctx: Context, now = new Date()) {
    const found = await this.candidates(brandId, ctx, now);
    if (found.branchIds.length === 0) {
      throw new ApiException(
        409,
        'NO_ELIGIBLE_BRANCH',
        `No branch can deliver this cart on that day (${found.reason ?? 'NO_SLOTS'})`,
      );
    }
    const { ranking, rules } = await this.rank(brandId, ctx, found.zoneId, found.branchIds);
    return { branchId: ranking[0]!.branchId, ranking, rules };
  }

  /** Staff view: who would be chosen and why, and whether a branch picked by hand is allowed. */
  async preview(
    actor: AdminActor,
    brandId: string,
    body: z.infer<typeof assignmentPreviewBody>,
    now = new Date(),
  ) {
    this.access.assertReaches(actor, brandId, ['delivery.view']);
    this.can(actor, 'delivery.view', brandId, body.marketId);
    const found = await this.candidates(brandId, body, now).catch((err: unknown) => {
      if (err instanceof ApiException && err.code === 'SLOT_UNAVAILABLE') {
        return { zoneId: null, reason: 'SLOT_UNAVAILABLE', branchIds: [] as string[] };
      }
      throw err;
    });
    const ranked = found.branchIds.length
      ? await this.rank(brandId, body, found.zoneId, found.branchIds)
      : { ranking: [] as RankedBranch[], rules: [] as AssignmentRuleKind[] };
    return {
      chosenBranchId: ranked.ranking[0]?.branchId ?? null,
      reason: found.branchIds.length ? null : (found.reason ?? 'NO_SLOTS'),
      rules: ranked.rules,
      ranking: ranked.ranking,
      ...(body.branchId && {
        check: { branchId: body.branchId, eligible: found.branchIds.includes(body.branchId) },
      }),
    };
  }

  /**
   * A manual choice or reassignment: allowed only for a branch that can deliver (the same eligible
   * set as above), and always audited with the reason. Phase 6 stores the result on the order.
   */
  async override(
    actor: AdminActor,
    brandId: string,
    body: z.infer<typeof assignmentOverrideBody>,
    now = new Date(),
  ) {
    this.access.assertReaches(actor, brandId, ['delivery.assign']);
    this.can(actor, 'delivery.assign', brandId, body.marketId);
    const found = await this.candidates(brandId, body, now);
    if (!found.branchIds.includes(body.branchId)) {
      throw new ApiException(
        422,
        'BRANCH_NOT_ELIGIBLE',
        `That branch cannot deliver this cart on that day (${found.reason ?? 'NOT_AMONG_ELIGIBLE_BRANCHES'})`,
      );
    }
    const { ranking } = await this.rank(brandId, body, found.zoneId, found.branchIds);
    const automatic = ranking[0]!.branchId;
    return this.access.runPublic(brandId, async (tx) => {
      await this.access.recordFor(tx, actor, {
        brandId,
        marketId: body.marketId,
        branchId: body.branchId,
        action: 'delivery.assignment.override',
        targetType: 'branch',
        targetId: body.branchId,
        before: { automaticBranchId: automatic },
        after: {
          branchId: body.branchId,
          date: body.date,
          slotId: body.slotId ?? null,
          reference: body.reference ?? null,
          reason: body.reason,
        },
      });
      return {
        branchId: body.branchId,
        automaticBranchId: automatic,
        changed: automatic !== body.branchId,
      };
    });
  }
}
