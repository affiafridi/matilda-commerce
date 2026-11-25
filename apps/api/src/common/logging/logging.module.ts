import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { APP_ENV, type Env } from '../../config/env';

/**
 * Structured Pino logging with request ids. Secrets and credentials are redacted;
 * never log passwords, payment secrets or unnecessary personal data (docs/SECURITY.md).
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [APP_ENV],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          genReqId: (req, res) => {
            const incoming = req.headers['x-request-id'];
            const id =
              typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming)
                ? incoming
                : randomUUID();
            res.setHeader('x-request-id', id);
            return id;
          },
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers["set-cookie"]',
              'req.body.password',
              'req.body.token',
            ],
            censor: '[REDACTED]',
          },
          autoLogging: {
            ignore: (req) => (req.url ?? '').startsWith('/api/v1/health'),
          },
          ...(env.NODE_ENV === 'development'
            ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
            : {}),
        },
      }),
    }),
  ],
})
export class AppLoggingModule {}
