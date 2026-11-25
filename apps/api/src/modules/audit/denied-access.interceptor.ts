import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { type Observable, catchError, from, switchMap, throwError } from 'rxjs';
import { RequestContextService } from '../../common/context/request-context.service';
import { ApiException } from '../../common/errors/api-exception';
import { PERMISSION_METADATA } from '../iam/authorization/decorators';
import { AuditService } from './audit.service';

/**
 * Records a DENIED audit row when a protected handler refuses an authenticated staff member
 * (scope violation, escalation attempt). Denials raised by the guard itself on sensitive routes are
 * recorded by the guard, because interceptors do not run after a guard rejects.
 */
@Injectable()
export class DeniedAccessInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly context: RequestContextService,
    private readonly audit: AuditService,
  ) {}

  intercept(executionContext: ExecutionContext, next: CallHandler): Observable<unknown> {
    const declared = this.reflector.getAllAndOverride<object | undefined>(PERMISSION_METADATA, [
      executionContext.getHandler(),
      executionContext.getClass(),
    ]);
    return next.handle().pipe(
      catchError((err: unknown) => {
        const denied = err instanceof ApiException && err.getStatus() === 403;
        if (!declared || !denied || this.context.actor.type !== 'staff') {
          return throwError(() => err);
        }
        const req = executionContext.switchToHttp().getRequest<Request>();
        return from(
          this.audit.recordStandalone({
            action: 'access.denied',
            targetType: 'route',
            targetId: `${req.method} ${(req.route as { path?: string } | undefined)?.path ?? req.path}`,
            outcome: 'DENIED',
            after: { code: err.code },
          }),
        ).pipe(switchMap(() => throwError(() => err)));
      }),
    );
  }
}
