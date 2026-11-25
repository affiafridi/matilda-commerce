import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthorizationService } from './authorization/authorization.service';
import { PermissionsGuard } from './authorization/permissions.guard';
import { AssignmentService } from './roles/assignment.service';
import { RoleService } from './roles/role.service';

@Global()
@Module({
  providers: [
    AuthorizationService,
    RoleService,
    AssignmentService,
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [AuthorizationService, RoleService, AssignmentService],
})
export class IamModule {}
