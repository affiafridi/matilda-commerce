import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp, GLOBAL_PREFIX } from './app.setup';
import { loadEnv } from './config/env';

async function bootstrap(): Promise<void> {
  try {
    process.loadEnvFile('.env');
  } catch {
    // .env is optional; variables may come from the real environment.
  }
  const env = loadEnv();

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  configureApp(app, env);

  await app.listen(env.PORT, env.HOST);
  const logger = app.get(Logger);
  logger.log(`API listening on http://localhost:${env.PORT}/${GLOBAL_PREFIX}/v1`);
  if (env.SWAGGER_ENABLED) {
    logger.log(`Swagger UI: http://localhost:${env.PORT}/${GLOBAL_PREFIX}/docs`);
  }
}

bootstrap().catch((err: unknown) => {
  // Logger may not exist yet (e.g., invalid env); write plainly and exit non-zero.
  console.error(err);
  process.exit(1);
});
