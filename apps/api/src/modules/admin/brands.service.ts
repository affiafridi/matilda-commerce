import { Injectable } from '@nestjs/common';
import { z } from '@matilda/validation';
import { ApiException } from '../../common/errors/api-exception';
import { PrismaService } from '../../database/prisma.service';
import { withScope } from '../../database/scope';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../iam/authorization/authorization.service';
import { normalizeHost } from '../tenancy/host';
import { TenantResolver } from '../tenancy/tenant-resolver.service';
import { type AdminActor, assertCan, isUniqueViolation, notFound } from './admin-common';

export const createBrandBody = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Lowercase letters, digits and single dashes')
    .max(40),
  name: z.string().trim().min(1).max(120),
  legalEntityName: z.string().trim().max(200).optional(),
});
export const updateBrandBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    legalEntityName: z.string().trim().max(200).nullable(),
    status: z.enum(['ACTIVE', 'INACTIVE']),
  })
  .partial();

const hostname = z
  .string()
  .transform((v, ctx) => {
    const host = normalizeHost(v);
    if (!host) ctx.addIssue({ code: 'custom', message: 'Not a valid hostname' });
    return host ?? '';
  })
  .pipe(z.string().min(1));
export const createDomainBody = z.object({
  hostname,
  marketId: z.string().uuid().nullish(),
  defaultLanguageCode: z.string().min(2).max(10).nullish(),
  isPrimary: z.boolean().default(false),
  redirectToPrimary: z.boolean().default(false),
});
export const updateDomainBody = createDomainBody
  .omit({ hostname: true })
  .partial()
  .extend({ isPrimary: z.boolean().optional(), redirectToPrimary: z.boolean().optional() });

type CreateBrand = z.infer<typeof createBrandBody>;
type UpdateBrand = z.infer<typeof updateBrandBody>;
type CreateDomain = z.infer<typeof createDomainBody>;
type UpdateDomain = z.infer<typeof updateDomainBody>;

@Injectable()
export class BrandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly authz: AuthorizationService,
    private readonly resolver: TenantResolver,
  ) {}

  async list(actor: AdminActor) {
    const scope = await this.authz.dbScopeFor(actor.grants, 'brands.view');
    return withScope(this.prisma.client, scope, (tx) =>
      tx.brand.findMany({ orderBy: { name: 'asc' }, include: { domains: true } }),
    );
  }

  async get(actor: AdminActor, id: string) {
    const scope = await this.authz.dbScopeFor(actor.grants, 'brands.view');
    const brand = await withScope(this.prisma.client, scope, (tx) =>
      tx.brand.findUnique({ where: { id }, include: { domains: true } }),
    );
    if (!brand) throw notFound('Brand');
    return brand;
  }

  /** Creating a brand is platform-level: only a grant without brand restriction covers it. */
  async create(actor: AdminActor, input: CreateBrand) {
    assertCan(actor.grants, 'brands.manage', {});
    try {
      return await withScope(this.prisma.client, { brandIds: [], platform: true }, async (tx) => {
        const brand = await tx.brand.create({ data: input });
        await this.audit.record(tx, {
          action: 'brand.create',
          targetType: 'brand',
          targetId: brand.id,
          actor: { type: 'STAFF', id: actor.staffId },
          brandId: brand.id,
          after: input,
        });
        return brand;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ApiException(409, 'BRAND_SLUG_TAKEN', 'A brand with this slug already exists');
      }
      throw err;
    }
  }

  async update(actor: AdminActor, id: string, patch: UpdateBrand) {
    assertCan(actor.grants, 'brands.manage', { brandId: id });
    const updated = await withScope(this.prisma.client, { brandIds: [id] }, async (tx) => {
      const before = await tx.brand.findUnique({ where: { id } });
      if (!before) throw notFound('Brand');
      const brand = await tx.brand.update({ where: { id }, data: patch });
      await this.audit.record(tx, {
        action: 'brand.update',
        targetType: 'brand',
        targetId: id,
        actor: { type: 'STAFF', id: actor.staffId },
        brandId: id,
        before: {
          name: before.name,
          legalEntityName: before.legalEntityName,
          status: before.status,
        },
        after: patch,
      });
      return brand;
    });
    this.resolver.invalidateBrand(id);
    return updated;
  }

  async listDomains(actor: AdminActor, brandId: string) {
    return (await this.get(actor, brandId)).domains;
  }

  async addDomain(actor: AdminActor, brandId: string, input: CreateDomain) {
    assertCan(actor.grants, 'brands.manage', { brandId });
    try {
      const domain = await withScope(this.prisma.client, { brandIds: [brandId] }, async (tx) => {
        if (!(await tx.brand.findUnique({ where: { id: brandId } }))) throw notFound('Brand');
        if (input.isPrimary) {
          await tx.brandDomain.updateMany({ where: { brandId }, data: { isPrimary: false } });
        }
        const created = await tx.brandDomain.create({
          data: { ...input, marketId: input.marketId ?? null, brandId },
        });
        await this.audit.record(tx, {
          action: 'brand.domain.add',
          targetType: 'brand_domain',
          targetId: created.id,
          actor: { type: 'STAFF', id: actor.staffId },
          brandId,
          after: input,
        });
        return created;
      });
      this.resolver.invalidateBrand(brandId);
      return domain;
    } catch (err) {
      throw this.domainError(err);
    }
  }

  async updateDomain(actor: AdminActor, brandId: string, domainId: string, patch: UpdateDomain) {
    assertCan(actor.grants, 'brands.manage', { brandId });
    try {
      const domain = await withScope(this.prisma.client, { brandIds: [brandId] }, async (tx) => {
        const before = await tx.brandDomain.findFirst({ where: { id: domainId, brandId } });
        if (!before) throw notFound('Domain');
        if (patch.isPrimary) {
          await tx.brandDomain.updateMany({ where: { brandId }, data: { isPrimary: false } });
        }
        const updated = await tx.brandDomain.update({ where: { id: domainId }, data: patch });
        await this.audit.record(tx, {
          action: 'brand.domain.update',
          targetType: 'brand_domain',
          targetId: domainId,
          actor: { type: 'STAFF', id: actor.staffId },
          brandId,
          before: { hostname: before.hostname, isPrimary: before.isPrimary },
          after: patch,
        });
        return updated;
      });
      this.resolver.invalidateBrand(brandId);
      return domain;
    } catch (err) {
      throw this.domainError(err);
    }
  }

  async removeDomain(actor: AdminActor, brandId: string, domainId: string): Promise<void> {
    assertCan(actor.grants, 'brands.manage', { brandId });
    await withScope(this.prisma.client, { brandIds: [brandId] }, async (tx) => {
      const before = await tx.brandDomain.findFirst({ where: { id: domainId, brandId } });
      if (!before) throw notFound('Domain');
      await tx.brandDomain.delete({ where: { id: domainId } });
      await this.audit.record(tx, {
        action: 'brand.domain.remove',
        targetType: 'brand_domain',
        targetId: domainId,
        actor: { type: 'STAFF', id: actor.staffId },
        brandId,
        before: { hostname: before.hostname },
      });
    });
    this.resolver.invalidateBrand(brandId);
  }

  private domainError(err: unknown): unknown {
    if (err instanceof ApiException) return err;
    if (isUniqueViolation(err)) {
      return new ApiException(409, 'DOMAIN_TAKEN', 'This hostname is already in use');
    }
    const text = err instanceof Error ? `${err.message} ${String(err.cause ?? '')}` : '';
    if (/foreign key|violat/i.test(text)) {
      return new ApiException(422, 'INVALID_MARKET', 'The market does not belong to this brand');
    }
    return err;
  }
}
