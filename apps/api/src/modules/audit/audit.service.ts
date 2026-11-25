import { Injectable, Optional } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { RequestContextService } from '../../common/context/request-context.service';
import { PrismaService } from '../../database/prisma.service';
import { withScope, type DbScope } from '../../database/scope';
import type { AuditActorType, AuditOutcome, Prisma } from '../../generated/prisma/client';
import { redact } from './redact';

export interface AuditEntry {
  /** Stable dotted name, e.g. `role.create`, `assignment.revoke`, `access.denied`. */
  action: string;
  targetType: string;
  targetId?: string;
  outcome?: AuditOutcome;
  before?: unknown;
  after?: unknown;
  /** Defaults to the request's actor. */
  actor?: { type: AuditActorType; id?: string };
  brandId?: string | null;
  marketId?: string | null;
  branchId?: string | null;
}

export interface AuditQuery {
  from?: Date;
  to?: Date;
  actorType?: AuditActorType;
  actorId?: string;
  /** Exact action, or a prefix ending in `.` (e.g. `role.`). */
  action?: string;
  targetType?: string;
  targetId?: string;
  outcome?: AuditOutcome;
  brandId?: string;
  /** Return rows older than this id (keyset pagination, newest first). */
  before?: bigint;
  limit?: number;
}

export interface AuditRow {
  id: string;
  occurredAt: string;
  actorType: AuditActorType;
  actorId: string | null;
  brandId: string | null;
  marketId: string | null;
  branchId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  outcome: AuditOutcome;
  before: unknown;
  after: unknown;
  requestId: string | null;
}

export interface AuditPage {
  items: AuditRow[];
  /** Pass as `before` to fetch the next (older) page; null when exhausted. */
  nextBefore: string | null;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const ACTOR_TYPES: Record<string, AuditActorType> = {
  staff: 'STAFF',
  customer: 'CUSTOMER',
  guest: 'GUEST',
  system: 'SYSTEM',
};

@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContextService,
    @Optional() private readonly logger?: PinoLogger,
  ) {}

  /**
   * Writes an audit row INSIDE the caller's transaction, so a change and its audit row commit or
   * roll back together. Uses INSERT without RETURNING (the read policy is brand-scoped).
   */
  async record(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
    await tx.auditLog.createMany({ data: [this.toRow(entry)] });
  }

  /**
   * Writes an audit row in its own transaction, for events that have no change to join
   * (denials, failed logins). Never throws: an audit failure must not alter the response.
   */
  async recordStandalone(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.client.auditLog.createMany({ data: [this.toRow(entry)] });
    } catch (err) {
      if (this.logger)
        this.logger.error({ err, action: entry.action }, 'Failed to write audit row');
      else
        process.stderr.write(`Failed to write audit row (${entry.action}): ${String(err)}
`);
    }
  }

  /** Reads audit rows visible within `scope` (use `AuthorizationService.dbScopeFor(grants, 'audit.view')`). */
  async query(scope: DbScope, filter: AuditQuery = {}): Promise<AuditPage> {
    const limit = Math.min(Math.max(filter.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const where: Prisma.AuditLogWhereInput = {
      ...(filter.from || filter.to ? { occurredAt: { gte: filter.from, lte: filter.to } } : {}),
      ...(filter.actorType && { actorType: filter.actorType }),
      ...(filter.actorId && { actorId: filter.actorId }),
      ...(filter.action &&
        (filter.action.endsWith('.')
          ? { action: { startsWith: filter.action } }
          : { action: filter.action })),
      ...(filter.targetType && { targetType: filter.targetType }),
      ...(filter.targetId && { targetId: filter.targetId }),
      ...(filter.outcome && { outcome: filter.outcome }),
      ...(filter.brandId && { brandId: filter.brandId }),
      ...(filter.before !== undefined && { id: { lt: filter.before } }),
    };
    const rows = await withScope(this.prisma.client, scope, (tx) =>
      tx.auditLog.findMany({ where, orderBy: { id: 'desc' }, take: limit + 1 }),
    );
    const page = rows.slice(0, limit);
    return {
      items: page.map((r) => ({
        id: r.id.toString(),
        occurredAt: r.occurredAt.toISOString(),
        actorType: r.actorType,
        actorId: r.actorId,
        brandId: r.brandId,
        marketId: r.marketId,
        branchId: r.branchId,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        outcome: r.outcome,
        before: r.before,
        after: r.after,
        requestId: r.requestId,
      })),
      nextBefore: rows.length > limit ? (page[page.length - 1]?.id.toString() ?? null) : null,
    };
  }

  private toRow(entry: AuditEntry): Prisma.AuditLogCreateManyInput {
    const ctxActor = this.context.actor;
    const actor = entry.actor ?? {
      type: ACTOR_TYPES[ctxActor.type] ?? 'GUEST',
      id: ctxActor.id,
    };
    return {
      actorType: actor.type,
      actorId: actor.id ?? null,
      brandId: entry.brandId ?? this.context.brand?.id ?? null,
      marketId: entry.marketId ?? this.context.market?.id ?? null,
      branchId: entry.branchId ?? null,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      outcome: entry.outcome ?? 'SUCCESS',
      before:
        entry.before === undefined ? undefined : (redact(entry.before) as Prisma.InputJsonValue),
      after: entry.after === undefined ? undefined : (redact(entry.after) as Prisma.InputJsonValue),
      ip: this.context.ip ?? null,
      userAgent: this.context.userAgent ?? null,
      requestId: this.context.requestId === 'unknown' ? null : this.context.requestId,
    };
  }
}
