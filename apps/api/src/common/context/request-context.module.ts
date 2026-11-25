import { Global, Module } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ClsModule } from 'nestjs-cls';
import { RequestContextService } from './request-context.service';

@Global()
@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        setup: (cls, req: Request & { id?: string | number }, res: Response) => {
          const header = res.getHeader('x-request-id');
          cls.set('requestId', String(req.id ?? (typeof header === 'string' ? header : 'unknown')));
          cls.set('actor', { type: 'guest' });
          cls.set('ip', req.ip);
          cls.set('userAgent', req.headers['user-agent']?.slice(0, 300));
        },
      },
    }),
  ],
  providers: [RequestContextService],
  exports: [RequestContextService],
})
export class RequestContextModule {}
