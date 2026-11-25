import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminMeController } from './admin-me.controller';
import { AuthAttemptService } from './attempt.service';
import { PasswordService } from './password.service';
import { StaffSessionService } from './session.service';
import { StaffAuthController } from './staff-auth.controller';
import { StaffAuthService } from './staff-auth.service';
import { TotpService } from './totp.service';

@Global()
@Module({
  // In-memory counters are per API instance; a shared store (Redis) replaces them when scaling out.
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }])],
  controllers: [StaffAuthController, AdminMeController],
  providers: [
    PasswordService,
    TotpService,
    AuthAttemptService,
    StaffSessionService,
    StaffAuthService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
  exports: [StaffSessionService, StaffAuthService, PasswordService, AuthAttemptService],
})
export class StaffAuthModule {}
