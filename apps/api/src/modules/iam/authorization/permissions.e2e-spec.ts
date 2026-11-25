import { Controller, Get, type INestApplication, Module, Post, Req } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ModulesContainer } from '@nestjs/core/injector/modules-container';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../../app.module';
import { ApiException } from '../../../common/errors/api-exception';
import { AuditService } from '../../audit/audit.service';
import { configureApp } from '../../../app.setup';
import { hashToken } from '../../../common/security/tokens';
import { type SessionInfo, StaffSessionService } from '../../staff-auth/session.service';
import { loadEnv } from '../../../config/env';
import { AuthorizationService } from './authorization.service';
import {
  AuthenticatedStaff,
  PERMISSION_METADATA,
  PUBLIC_METADATA,
  PublicRoute,
  RequirePermission,
  STAFF_ONLY_METADATA,
} from './decorators';
import type { Grant } from './scope';

@Controller({ path: 'iam-test', version: '1' })
class IamTestController {
  @Get('open')
  @PublicRoute()
  open() {
    return { ok: true };
  }

  @Get('orders')
  @RequirePermission('orders.view')
  orders() {
    return { ok: true };
  }

  @Get('branch/:branchId')
  @RequirePermission('orders.view', {
    target: (req) => ({ branchId: req.params.branchId as string }),
  })
  branch(@Req() req: { params: { branchId: string } }) {
    return { branch: req.params.branchId };
  }

  @Get('sensitive')
  @RequirePermission('roles.manage')
  sensitive() {
    return { ok: true };
  }

  @Get('refuses')
  @RequirePermission('orders.view')
  refuses() {
    throw new ApiException(403, 'ESCALATION_DENIED', 'nope');
  }

  @Post('orders')
  @RequirePermission('orders.view')
  createOrder() {
    return { ok: true };
  }

  @Get('whoami')
  @AuthenticatedStaff()
  whoami() {
    return { ok: true };
  }

  @Get('undeclared')
  undeclared() {
    return { ok: true };
  }
}

@Module({ controllers: [IamTestController] })
class IamTestModule {}

const grantFor = (permissions: string[], scope: Grant['scope']): Grant => ({
  assignmentId: 'a',
  roleId: 'r',
  permissions: new Set(permissions),
  scope,
});

describe('PermissionsGuard (HTTP)', () => {
  let app: INestApplication;
  let session: SessionInfo | null = null;
  let grants: Grant[] = [];
  const recordStandalone = jest.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'silent';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule, IamTestModule] })
      .overrideProvider(StaffSessionService)
      .useValue({
        authenticate: async (_token: string | undefined, o: { verifiedOnly: boolean }) =>
          session && (!o.verifiedOnly || session.mfaVerified) ? session : null,
      })
      .overrideProvider(AuditService)
      .useValue({ recordStandalone })
      .overrideProvider(AuthorizationService)
      .useValue({ loadGrants: async () => grants })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app, loadEnv());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (path: string) => request(app.getHttpServer()).get(`/api/v1/iam-test/${path}`);
  const staff = (over: Partial<SessionInfo> = {}): SessionInfo => ({
    id: 'sess1',
    staffUserId: 's1',
    mfaVerified: true,
    stepUpUntil: new Date(Date.now() + 60_000),
    absoluteExpiresAt: new Date(Date.now() + 3_600_000),
    csrfHash: hashToken('csrf-good'),
    ...over,
  });

  beforeEach(() => {
    session = null;
    grants = [];
    recordStandalone.mockClear();
  });

  it('serves explicitly public routes to anyone', async () => {
    await get('open').expect(200);
  });

  it('fails closed on routes that declare nothing', async () => {
    const res = await get('undeclared').expect(403);
    expect(res.body.code).toBe('ROUTE_NOT_DECLARED');
  });

  it('answers 401 without a session', async () => {
    await get('orders').expect(401);
    await get('whoami').expect(401);
  });

  it('never accepts a pending (pre-2FA) session', async () => {
    session = staff({ mfaVerified: false });
    grants = [grantFor(['orders.view'], {})];
    await get('orders').expect(401);
    await get('whoami').expect(401);
  });

  it('lets any verified staff session reach an AuthenticatedStaff route', async () => {
    session = staff();
    await get('whoami').expect(200);
  });

  it('rejects mutations without an allowed Origin or a valid CSRF token', async () => {
    session = staff();
    grants = [grantFor(['orders.view'], {})];
    const post = () => request(app.getHttpServer()).post('/api/v1/iam-test/orders');
    expect((await post().expect(403)).body.code).toBe('ORIGIN_NOT_ALLOWED');
    expect(
      (await post().set('Origin', 'https://evil.test').set('X-CSRF-Token', 'csrf-good').expect(403))
        .body.code,
    ).toBe('ORIGIN_NOT_ALLOWED');
    expect((await post().set('Origin', 'http://localhost:3001').expect(403)).body.code).toBe(
      'CSRF_FAILED',
    );
    expect(
      (await post().set('Origin', 'http://localhost:3001').set('X-CSRF-Token', 'nope').expect(403))
        .body.code,
    ).toBe('CSRF_FAILED');
    await post()
      .set('Origin', 'http://localhost:3001')
      .set('X-CSRF-Token', 'csrf-good')
      .expect(201);
  });

  it('requires a fresh step-up for sensitive permissions', async () => {
    grants = [grantFor(['roles.manage'], {})];
    session = staff({ stepUpUntil: null });
    expect((await get('sensitive').expect(403)).body.code).toBe('STEP_UP_REQUIRED');
    session = staff({ stepUpUntil: new Date(Date.now() - 1000) });
    expect((await get('sensitive').expect(403)).body.code).toBe('STEP_UP_REQUIRED');
    session = staff();
    await get('sensitive').expect(200);
  });

  it('answers 403 to staff without the permission and 200 with it', async () => {
    session = staff();
    await get('orders').expect(403);
    grants = [grantFor(['orders.view'], {})];
    await get('orders').expect(200);
  });

  it('audits denials on sensitive routes only', async () => {
    session = staff();
    grants = [grantFor(['orders.view'], {})];
    await get('sensitive').expect(403);
    expect(recordStandalone).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'access.denied',
        outcome: 'DENIED',
        targetId: expect.stringContaining('/sensitive'),
      }),
    );
    recordStandalone.mockClear();
    grants = [];
    await get('orders').expect(403);
    expect(recordStandalone).not.toHaveBeenCalled();
  });

  it('audits denials raised inside a protected handler', async () => {
    session = staff();
    grants = [grantFor(['orders.view'], {})];
    const res = await get('refuses').expect(403);
    expect(res.body.code).toBe('ESCALATION_DENIED');
    expect(recordStandalone).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'access.denied', after: { code: 'ESCALATION_DENIED' } }),
    );
  });

  it('checks the data scope of the target when the route declares one', async () => {
    session = staff();
    grants = [grantFor(['orders.view'], { branchId: 'x' })];
    await get('branch/x').expect(200);
    await get('branch/y').expect(403);
  });
});

describe('route declarations', () => {
  it('every controller route is either public or declares a permission', async () => {
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'silent';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    const reflector = app.get(Reflector);
    const undeclared: string[] = [];
    for (const mod of app.get(ModulesContainer).values()) {
      for (const wrapper of mod.controllers.values()) {
        const type = wrapper.metatype as (new () => object) | null;
        if (!type) continue;
        for (const name of Object.getOwnPropertyNames(type.prototype)) {
          const handler = (type.prototype as Record<string, unknown>)[name];
          if (name === 'constructor' || typeof handler !== 'function') continue;
          if (Reflect.getMetadata('path', handler) === undefined) continue; // not a route
          const targets = [handler, type];
          const declared =
            reflector.getAllAndOverride(PUBLIC_METADATA, targets) ||
            reflector.getAllAndOverride(PERMISSION_METADATA, targets) ||
            reflector.getAllAndOverride(STAFF_ONLY_METADATA, targets);
          if (!declared) undeclared.push(`${type.name}.${name}`);
        }
      }
    }
    await app.close();
    expect(undeclared).toEqual([]);
  });
});
