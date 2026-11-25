import { Injectable } from '@nestjs/common';
import { ClsService, type ClsStore } from 'nestjs-cls';

export type ActorType = 'staff' | 'customer' | 'guest' | 'system';

export interface RequestActor {
  type: ActorType;
  /** Absent for guests. */
  id?: string;
}

/** Reference to a resolved tenant record. Filled in by the tenant resolver (plan step 2.3). */
export interface TenantRef {
  id: string;
  slug: string;
}

export interface RequestContextStore extends ClsStore {
  requestId: string;
  actor: RequestActor;
  brand?: TenantRef;
  market?: TenantRef;
  language?: string;
  ip?: string;
  userAgent?: string;
}

/**
 * Per-request state (AsyncLocalStorage). Every guard, service and audit write reads tenant and
 * actor from here. Clients can never inject these values; only server-side resolvers set them.
 */
@Injectable()
export class RequestContextService {
  constructor(private readonly cls: ClsService<RequestContextStore>) {}

  get requestId(): string {
    return this.cls.get('requestId') ?? 'unknown';
  }

  get actor(): RequestActor {
    return this.cls.get('actor') ?? { type: 'guest' };
  }

  get brand(): TenantRef | undefined {
    return this.cls.get('brand');
  }

  get market(): TenantRef | undefined {
    return this.cls.get('market');
  }

  get language(): string | undefined {
    return this.cls.get('language');
  }

  get ip(): string | undefined {
    return this.cls.get('ip');
  }

  get userAgent(): string | undefined {
    return this.cls.get('userAgent');
  }

  setActor(actor: RequestActor): void {
    this.cls.set('actor', actor);
  }

  setTenant(tenant: { brand?: TenantRef; market?: TenantRef; language?: string }): void {
    if (tenant.brand) this.cls.set('brand', tenant.brand);
    if (tenant.market) this.cls.set('market', tenant.market);
    if (tenant.language) this.cls.set('language', tenant.language);
  }

  /** Brand for tenant-owned data access; throws if the request has no resolved brand. */
  requireBrand(): TenantRef {
    const brand = this.brand;
    if (!brand) throw new Error('No brand resolved for this request');
    return brand;
  }
}
