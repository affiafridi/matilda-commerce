import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { configureApp } from '../../app.setup';
import { loadEnv } from '../../config/env';

describe('Health (HTTP)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // No DATABASE_URL: readiness must report "down" without crashing.
    delete process.env.DATABASE_URL;
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'silent';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app, loadEnv());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health returns liveness', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', service: 'matilda-api' });
    expect(typeof res.body.uptimeSeconds).toBe('number');
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('GET /api/v1/health/ready returns 503 when the database is not configured', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(503);
    expect(res.body.status).toBe('down');
    expect(res.body.checks.database.status).toBe('down');
  });

  it('unknown routes use the standard error body', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/nope').expect(404);
    expect(res.body).toMatchObject({ statusCode: 404, code: 'NOT_FOUND', path: '/api/v1/nope' });
    expect(res.body.requestId).toBeDefined();
  });

  it('echoes a valid incoming x-request-id', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('x-request-id', 'test-request-12345')
      .expect(200);
    expect(res.headers['x-request-id']).toBe('test-request-12345');
  });
});
