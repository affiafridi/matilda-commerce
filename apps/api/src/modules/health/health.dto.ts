import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  HealthResponse,
  HealthStatus,
  ReadinessCheck,
  ReadinessResponse,
} from '@matilda/types';

const STATUSES: HealthStatus[] = ['ok', 'degraded', 'down'];

export class HealthResponseDto implements HealthResponse {
  @ApiProperty({ enum: STATUSES }) status!: HealthStatus;
  @ApiProperty({ example: 'matilda-api' }) service!: string;
  @ApiProperty({ example: '0.1.0' }) version!: string;
  @ApiProperty({ example: 123 }) uptimeSeconds!: number;
  @ApiProperty({ format: 'date-time' }) timestamp!: string;
}

export class ReadinessCheckDto implements ReadinessCheck {
  @ApiProperty({ enum: STATUSES }) status!: HealthStatus;
  @ApiPropertyOptional() latencyMs?: number;
  @ApiPropertyOptional() detail?: string;
}

export class ReadinessResponseDto implements ReadinessResponse {
  @ApiProperty({ enum: STATUSES }) status!: HealthStatus;
  @ApiProperty({ format: 'date-time' }) timestamp!: string;
  @ApiProperty({
    type: 'object',
    additionalProperties: { $ref: '#/components/schemas/ReadinessCheckDto' },
  })
  checks!: Record<string, ReadinessCheckDto>;
}
