/** Standard error body returned by every API endpoint. See docs/API.md. */
export interface ApiErrorBody {
  statusCode: number;
  /** Stable machine-readable code, e.g. VALIDATION_FAILED, NOT_FOUND. */
  code: string;
  message: string;
  /** Per-field validation problems, when applicable. */
  errors?: ApiFieldError[];
  /** Correlates the response with server logs. */
  requestId: string;
  timestamp: string;
  path: string;
}

export interface ApiFieldError {
  path: string;
  message: string;
}

export type HealthStatus = 'ok' | 'degraded' | 'down';

export interface HealthResponse {
  status: HealthStatus;
  service: string;
  version: string;
  uptimeSeconds: number;
  timestamp: string;
}

export interface ReadinessCheck {
  status: HealthStatus;
  latencyMs?: number;
  detail?: string;
}

export interface ReadinessResponse {
  status: HealthStatus;
  timestamp: string;
  checks: Record<string, ReadinessCheck>;
}
