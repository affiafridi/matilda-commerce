import type { ApiErrorBody, HealthResponse, ReadinessResponse } from '@matilda/types';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiErrorBody | null,
  ) {
    super(body?.message ?? `Request failed with status ${status}`);
    this.name = 'ApiError';
  }
}

export interface ApiClientOptions {
  /** Base URL of the API including the global prefix, e.g. http://localhost:4000/api/v1 */
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

export function createApiClient({ baseUrl, fetchImpl = fetch }: ApiClientOptions) {
  const root = baseUrl.replace(/\/+$/, '');

  async function get<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetchImpl(`${root}${path}`, {
      ...init,
      headers: { Accept: 'application/json', ...init?.headers },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
      throw new ApiError(res.status, body);
    }
    return (await res.json()) as T;
  }

  return {
    health: (init?: RequestInit) => get<HealthResponse>('/health', init),
    readiness: (init?: RequestInit) => get<ReadinessResponse>('/health/ready', init),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
