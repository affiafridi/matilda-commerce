import { type INestApplication, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import type { Env } from './config/env';

export const GLOBAL_PREFIX = 'api';

/** Shared by main.ts and HTTP tests so both run the same pipeline. */
export function configureApp(app: INestApplication, env: Env): void {
  app.setGlobalPrefix(GLOBAL_PREFIX);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.use(helmet());
  app.enableCors({
    origin: env.CORS_ORIGINS,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Idempotency-Key'],
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
