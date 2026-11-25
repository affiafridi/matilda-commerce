import { Injectable } from '@nestjs/common';
import type { HealthResponse, ReadinessResponse } from '@matilda/types';
import { PrismaService } from '../../database/prisma.service';

export const SERVICE_NAME = 'matilda-api';
// Kept in sync with apps/api/package.json by the build; avoids a runtime JSON import.
export const SERVICE_VERSION = process.env.npm_package_version ?? '0.1.0';

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness: the process is up. Must never depend on external systems. */
  liveness(): HealthResponse {
    return {
      status: 'ok',
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  /** Readiness: dependencies required to serve traffic are reachable. */
  async readiness(): Promise<ReadinessResponse> {
    const database = await this.prisma.ping();
    return {
      status: database.status === 'ok' ? 'ok' : 'down',
      timestamp: new Date().toISOString(),
      checks: { database },
    };
  }
}
