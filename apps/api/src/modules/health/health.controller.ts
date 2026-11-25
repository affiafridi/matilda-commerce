import { Controller, Get, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import type { HealthResponse, ReadinessResponse } from '@matilda/types';
import { SkipThrottle } from '@nestjs/throttler';
import { PublicRoute } from '../iam/authorization/decorators';
import { HealthResponseDto, ReadinessResponseDto } from './health.dto';
import { HealthService } from './health.service';

@PublicRoute()
@SkipThrottle()
@ApiTags('health')
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @ApiOperation({
    summary: 'Liveness probe',
    description: 'Returns 200 while the process is running.',
  })
  @ApiOkResponse({ type: HealthResponseDto })
  liveness(): HealthResponse {
    return this.health.liveness();
  }

  @Get('ready')
  @ApiOperation({
    summary: 'Readiness probe',
    description: 'Returns 200 when dependencies are reachable, otherwise 503.',
  })
  @ApiOkResponse({ type: ReadinessResponseDto })
  @ApiServiceUnavailableResponse({ type: ReadinessResponseDto })
  async readiness(@Res({ passthrough: true }) res: Response): Promise<ReadinessResponse> {
    const result = await this.health.readiness();
    if (result.status !== 'ok') res.status(503);
    return result;
  }
}
