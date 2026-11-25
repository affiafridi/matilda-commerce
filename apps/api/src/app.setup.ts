import { type INestApplication, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { Env } from './config/env';
import { TenantResolver } from './modules/tenancy/tenant-resolver.service';

export const GLOBAL_PREFIX = 'api';

/** Shared by main.ts and HTTP tests so both run the same pipeline. */
export function configureApp(app: INestApplication, env: Env): void {
  app.setGlobalPrefix(GLOBAL_PREFIX);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  const resolver = app.get(TenantResolver);

  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    // Static allow-list (admin, local dev) plus every registered brand domain (brand_domain).
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin || env.CORS_ORIGINS.includes(origin)) return callback(null, true);
      resolver.isBrandOrigin(origin).then(
        (ok) => callback(null, ok),
        () => callback(null, false),
      );
    },
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Request-Id',
      'Idempotency-Key',
      'X-CSRF-Token',
    ],
    exposedHeaders: ['X-Request-Id'],
  });

  if (env.SWAGGER_ENABLED) {
    const config = new DocumentBuilder()
      .setTitle('Matilda Commerce API')
      .setDescription(
        'Backend API for the Matilda Commerce platform. Surfaces: storefront, admin, customer, production, delivery, webhooks, integrations (see docs/API.md).',
      )
      .setVersion('1')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup(`${GLOBAL_PREFIX}/docs`, app, document);
  }
}
