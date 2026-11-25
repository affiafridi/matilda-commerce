import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from '@matilda/validation';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedStaff, RequirePermission } from '../iam/authorization/decorators';
import { RoleService } from '../iam/roles/role.service';
import { Actor, type AdminActor, uuidPipe } from './admin-common';
import {
  ADMIN_BRAND_HEADER,
  AccessService,
  auditQuery,
  cloneRoleBody,
  roleBody,
  updateRoleBody,
} from './access.service';
import { CustomersAdminService, customerListQuery } from './customers.service';
import {
  StaffService,
  assignmentBody,
  inviteStaffBody,
  staffListQuery,
  staffStatusBody,
  updateStaffBody,
} from './staff.service';

@ApiTags('admin-context')
@Controller({ path: 'admin/me', version: '1' })
export class AdminContextController {
  constructor(private readonly access: AccessService) {}

  @Get('context')
  @AuthenticatedStaff()
  @ApiOperation({
    summary: 'Your assignments, reachable brands and effective permissions',
    description:
      'Optional `X-Admin-Brand` header selects a working brand; it is validated against your grants.',
  })
  context(@Actor() actor: AdminActor, @Headers(ADMIN_BRAND_HEADER) brand?: string) {
    return this.access.context(actor, brand);
  }
}

@ApiTags('admin-staff')
@Controller({ path: 'admin/staff', version: '1' })
export class AdminStaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  @RequirePermission('users.view')
  @ApiOperation({ summary: 'List staff whose assignments lie within your scope' })
  list(
    @Actor() actor: AdminActor,
    @Query(new ZodValidationPipe(staffListQuery)) query: z.infer<typeof staffListQuery>,
  ) {
    return this.staff.list(actor, query);
  }

  @Get(':id')
  @RequirePermission('users.view')
  get(@Actor() actor: AdminActor, @Param('id', uuidPipe) id: string) {
    return this.staff.get(actor, id);
  }

  @Post()
  @RequirePermission('users.manage')
  @ApiOperation({
    summary: 'Invite a staff member with a first role assignment',
    description: 'Returns the one-time invitation link (no mail provider yet; share it manually).',
  })
  invite(
    @Actor() actor: AdminActor,
    @Body(new ZodValidationPipe(inviteStaffBody)) body: z.infer<typeof inviteStaffBody>,
  ) {
    return this.staff.invite(actor, body);
  }

  @Patch(':id')
  @RequirePermission('users.manage')
  update(
    @Actor() actor: AdminActor,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(updateStaffBody)) body: z.infer<typeof updateStaffBody>,
  ) {
    return this.staff.update(actor, id, body);
  }

  @Post(':id/invite')
  @HttpCode(200)
  @RequirePermission('users.manage')
  @ApiOperation({ summary: 'Issue a new invitation link for a member who has not accepted yet' })
  reinvite(@Actor() actor: AdminActor, @Param('id', uuidPipe) id: string) {
    return this.staff.reinvite(actor, id);
  }

  @Patch(':id/status')
  @RequirePermission('users.manage')
  @ApiOperation({ summary: 'Suspend, reactivate or deactivate (revokes all sessions)' })
  status(
    @Actor() actor: AdminActor,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(staffStatusBody)) body: z.infer<typeof staffStatusBody>,
  ) {
    return this.staff.setStatus(actor, id, body.status);
  }

  @Post(':id/assignments')
  @RequirePermission('users.manage')
  assign(
    @Actor() actor: AdminActor,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(assignmentBody)) body: z.infer<typeof assignmentBody>,
  ) {
    return this.staff.grant(actor, id, body);
  }
}

@ApiTags('admin-staff')
@Controller({ path: 'admin/assignments', version: '1' })
export class AdminAssignmentsController {
  constructor(private readonly staff: StaffService) {}

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('users.manage')
  async revoke(@Actor() actor: AdminActor, @Param('id', uuidPipe) id: string): Promise<void> {
    await this.staff.revoke(actor, id);
  }
}

@ApiTags('admin-roles')
@Controller({ path: 'admin', version: '1' })
export class AdminRolesController {
  constructor(
    private readonly access: AccessService,
    private readonly roles: RoleService,
  ) {}

  @Get('permissions')
  @RequirePermission('roles.view')
  @ApiOperation({ summary: 'The permission catalog' })
  permissions() {
    return this.access.permissions();
  }

  @Get('roles')
  @RequirePermission('roles.view')
  list() {
    return this.access.listRoles();
  }

  @Get('roles/:id')
  @RequirePermission('roles.view')
  get(@Param('id', uuidPipe) id: string) {
    return this.access.getRole(id);
  }

  @Post('roles')
  @RequirePermission('roles.manage')
  async create(
    @Actor() actor: AdminActor,
    @Body(new ZodValidationPipe(roleBody)) body: z.infer<typeof roleBody>,
  ) {
    const role = await this.roles.createCustom(actor.grants, body, actor.staffId);
    return this.access.getRole(role.id);
  }

  @Patch('roles/:id')
  @RequirePermission('roles.manage')
  async update(
    @Actor() actor: AdminActor,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(updateRoleBody)) body: z.infer<typeof updateRoleBody>,
  ) {
    await this.roles.updateCustom(actor.grants, id, body, actor.staffId);
    return this.access.getRole(id);
  }

  @Delete('roles/:id')
  @HttpCode(204)
  @RequirePermission('roles.manage')
  async remove(@Actor() actor: AdminActor, @Param('id', uuidPipe) id: string): Promise<void> {
    await this.roles.deleteCustom(id, actor.staffId);
  }

  @Post('roles/:id/clone')
  @RequirePermission('roles.manage')
  async clone(
    @Actor() actor: AdminActor,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(cloneRoleBody)) body: z.infer<typeof cloneRoleBody>,
  ) {
    const role = await this.roles.clone(actor.grants, id, body.name, actor.staffId);
    return this.access.getRole(role.id);
  }
}

@ApiTags('admin-audit')
@Controller({ path: 'admin/audit', version: '1' })
export class AdminAuditController {
  constructor(private readonly access: AccessService) {}

  @Get()
  @RequirePermission('audit.view')
  @ApiOperation({
    summary: 'Audit log within your scope, newest first (keyset paging via `before`)',
  })
  query(
    @Actor() actor: AdminActor,
    @Query(new ZodValidationPipe(auditQuery)) query: z.infer<typeof auditQuery>,
  ) {
    return this.access.queryAudit(actor, query);
  }
}

@ApiTags('admin-customers')
@Controller({ path: 'admin/customers', version: '1' })
export class AdminCustomersController {
  constructor(private readonly customers: CustomersAdminService) {}

  @Get()
  @RequirePermission('customers.view')
  @ApiOperation({ summary: 'Customer support list (read-only, brand-wide or platform-wide scope)' })
  list(
    @Actor() actor: AdminActor,
    @Query(new ZodValidationPipe(customerListQuery)) query: z.infer<typeof customerListQuery>,
  ) {
    return this.customers.list(actor, query);
  }

  @Get(':id')
  @RequirePermission('customers.view')
  get(@Actor() actor: AdminActor, @Param('id', uuidPipe) id: string) {
    return this.customers.get(actor, id);
  }
}
