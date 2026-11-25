import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditService } from './audit.service';
import { DeniedAccessInterceptor } from './denied-access.interceptor';

@Global()
@Module({
  providers: [AuditService, { provide: APP_INTERCEPTOR, useClass: DeniedAccessInterceptor }],
  exports: [AuditService],
})
export class AuditModule {}
