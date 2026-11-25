import { Module } from '@nestjs/common';
import { AccessService } from './access.service';
import {
  AdminAssignmentsController,
  AdminAuditController,
  AdminCustomersController,
  AdminContextController,
  AdminRolesController,
  AdminStaffController,
} from './access.controllers';
import { BranchesService } from './branches.service';
import { BrandsService } from './brands.service';
import { MarketsService } from './markets.service';
import {
  AdminBranchesController,
  AdminBrandsController,
  AdminMarketsController,
} from './platform.controllers';
import { CustomersAdminService } from './customers.service';
import { StaffService } from './staff.service';

/** Admin management APIs (Phase 2 step 2.7). Every route declares its permission; services re-check scope. */
@Module({
  controllers: [
    AdminContextController,
    AdminBrandsController,
    AdminMarketsController,
    AdminBranchesController,
    AdminStaffController,
    AdminAssignmentsController,
    AdminRolesController,
    AdminAuditController,
    AdminCustomersController,
  ],
  providers: [
    CustomersAdminService,
    AccessService,
    BrandsService,
    MarketsService,
    BranchesService,
    StaffService,
  ],
})
export class AdminModule {}
