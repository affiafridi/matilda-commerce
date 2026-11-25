import { createApiClient } from '@matilda/api-client';

export const DEFAULT_API_URL = 'http://localhost:4000/api/v1';

export function getApiBaseUrl(env: Record<string, string | undefined> = process.env): string {
  const configured = env.NEXT_PUBLIC_API_URL?.trim();
  return (configured || DEFAULT_API_URL).replace(/\/+$/, '');
}

export function getApi() {
  return createApiClient({ baseUrl: getApiBaseUrl() });
}
