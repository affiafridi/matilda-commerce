import { Controller, Get, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedStaff } from '../iam/authorization/decorators';
import type { RequestWithAuth } from '../iam/authorization/permissions.guard';
import { StaffAuthService } from './staff-auth.service';

@AuthenticatedStaff()
@ApiTags('admin-auth')
@Controller({ path: 'admin', version: '1' })
export class AdminMeController {
  constructor(private readonly auth: StaffAuthService) {}

  @Get('me')
  @ApiOperation({ summary: 'The signed-in staff member (requires completed 2FA)' })
  me(@Req() req: RequestWithAuth) {
    // The guard guarantees a verified session on this route.
    return this.auth.me(req.staffSession as NonNullable<RequestWithAuth['staffSession']>);
  }
}
