import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from '@matilda/validation';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { RequirePermission } from '../iam/authorization/decorators';
import { Actor, type AdminActor, uuidPipe } from './admin-common';
import {
  BrandsService,
  createBrandBody,
  createDomainBody,
  updateBrandBody,
  updateDomainBody,
} from './brands.service';
import { BranchesService, createBranchBody, updateBranchBody } from './branches.service';
import { MarketsService, createMarketBody, updateMarketBody } from './markets.service';

const brandFilter = z.object({ brandId: z.string().uuid().optional() });

@ApiTags('admin-brands')
@Controller({ path: 'admin/brands', version: '1' })
export class AdminBrandsController {
  constructor(private readonly brands: BrandsService) {}

  @Get()
  @RequirePermission('brands.view')
  @ApiOperation({ summary: 'List brands (and their domains) within your scope' })
  list(@Actor() actor: AdminActor) {
    return this.brands.list(actor);
  }

  @Get(':id')
  @RequirePermission('brands.view')
  get(@Actor() actor: AdminActor, @Param('id', uuidPipe) id: string) {
    return this.brands.get(actor, id);
  }

  @Post()
  @RequirePermission('brands.manage')
  @ApiOperation({ summary: 'Create a brand (platform-wide permission required)' })
  create(
    @Actor() actor: AdminActor,
    @Body(new ZodValidationPipe(createBrandBody)) body: z.infer<typeof createBrandBody>,
  ) {
    return this.brands.create(actor, body);
  }

  @Patch(':id')
  @RequirePermission('brands.manage')
  update(
    @Actor() actor: AdminActor,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(updateBrandBody)) body: z.infer<typeof updateBrandBody>,
  ) {
    return this.brands.update(actor, id, body);
  }

  @Get(':id/domains')
  @RequirePermission('brands.view')
  domains(@Actor() actor: AdminActor, @Param('id', uuidPipe) id: string) {
    return this.brands.listDomains(actor, id);
  }

  @Post(':id/domains')
  @RequirePermission('brands.manage')
  addDomain(
    @Actor() actor: AdminActor,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(createDomainBody)) body: z.infer<typeof createDomainBody>,
  ) {
    return this.brands.addDomain(actor, id, body);
  }

  @Patch(':id/domains/:domainId')
  @RequirePermission('brands.manage')
  updateDomain(
    @Actor() actor: AdminActor,
    @Param('id', uuidPipe) id: string,
    @Param('domainId', uuidPipe) domainId: string,
    @Body(new ZodValidationPipe(updateDomainBody)) body: z.infer<typeof updateDomainBody>,
  ) {
    return this.brands.updateDomain(actor, id, domainId, body);
  }

  @Delete(':id/domains/:domainId')
  @HttpCode(204)
  @RequirePermission('brands.manage')
  async removeDomain(
    @Actor() actor: AdminActor,
    @Param('id', uuidPipe) id: string,
    @Param('domainId', uuidPipe) domainId: string,
  ): Promise<void> {
    await this.brands.removeDomain(actor, id, domainId);
  }
}

@ApiTags('admin-markets')
@Controller({ path: 'admin/markets', version: '1' })
export class AdminMarketsController {
  constructor(private readonly markets: MarketsService) {}

  @Get()
  @RequirePermission('markets.view')
  list(
    @Actor() actor: AdminActor,
    @Query(new ZodValidationPipe(brandFilter)) query: z.infer<typeof brandFilter>,
  ) {
    return this.markets.list(actor, query.brandId);
  }

  @Get(':id')
  @RequirePermission('markets.view')
  get(@Actor() actor: AdminActor, @Param('id', uuidPipe) id: string) {
    return this.markets.get(actor, id);
  }

  @Post()
  @RequirePermission('markets.manage')
  create(
    @Actor() actor: AdminActor,
    @Body(new ZodValidationPipe(createMarketBody)) body: z.infer<typeof createMarketBody>,
  ) {
    return this.markets.create(actor, body);
  }

  @Patch(':id')
  @RequirePermission('markets.manage')
  update(
    @Actor() actor: AdminActor,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(updateMarketBody)) body: z.infer<typeof updateMarketBody>,
  ) {
    return this.markets.update(actor, id, body);
  }
}

@ApiTags('admin-branches')
@Controller({ path: 'admin/branches', version: '1' })
export class AdminBranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  @RequirePermission('branches.view')
  list(@Actor() actor: AdminActor) {
    return this.branches.list(actor);
  }

  @Get(':id')
  @RequirePermission('branches.view')
  get(@Actor() actor: AdminActor, @Param('id', uuidPipe) id: string) {
    return this.branches.get(actor, id);
  }

  @Post()
  @RequirePermission('branches.manage')
  create(
    @Actor() actor: AdminActor,
    @Body(new ZodValidationPipe(createBranchBody)) body: z.infer<typeof createBranchBody>,
  ) {
    return this.branches.create(actor, body);
  }

  @Patch(':id')
  @RequirePermission('branches.manage')
  @ApiOperation({ summary: 'Edit a branch (needs the permission over every market it serves)' })
  update(
    @Actor() actor: AdminActor,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(updateBranchBody)) body: z.infer<typeof updateBranchBody>,
  ) {
    return this.branches.update(actor, id, body);
  }

  @Put(':id/markets/:marketId')
  @RequirePermission('branches.manage')
  link(
    @Actor() actor: AdminActor,
    @Param('id', uuidPipe) id: string,
    @Param('marketId', uuidPipe) marketId: string,
  ) {
    return this.branches.linkMarket(actor, id, marketId);
  }

  @Delete(':id/markets/:marketId')
  @HttpCode(204)
  @RequirePermission('branches.manage')
  async unlink(
    @Actor() actor: AdminActor,
    @Param('id', uuidPipe) id: string,
    @Param('marketId', uuidPipe) marketId: string,
  ): Promise<void> {
    await this.branches.unlinkMarket(actor, id, marketId);
  }
}
