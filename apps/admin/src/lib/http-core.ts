import { ApiError } from '@matilda/api-client';
import type { ApiErrorBody } from '@matilda/types';

export type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface RequestOptions {
  /** Pass false for credential screens, where a 401 is an answer, not an expired session. */
  redirectOn401?: boolean;
  headers?: Record<string, string>;
}

export interface HttpDeps {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Called when the session is gone (401 outside credential screens). */
  onUnauthenticated?: () => void;
  /** Ask the person for a fresh 2FA code; resolves true once the step-up succeeded. */
  requestStepUp?: () => Promise<boolean>;
}

/** Routes that run before a session (or before a CSRF token exists) and are protected by Origin only. */
const PRE_SESSION = new Set([
  '/admin/auth/login',
  '/admin/auth/csrf',
  '/admin/auth/password/forgot',
  '/admin/auth/password/reset',
  '/admin/auth/invite/accept',
]);

/**
 * Browser-side HTTP client for the admin API (same-origin, cookie session).
 * - The CSRF token lives in this closure only; after a reload it is re-issued on first mutation.
 * - A rejected CSRF token is refreshed and the call retried once.
 * - `STEP_UP_REQUIRED` opens the code dialog (via `requestStepUp`) and retries once.
 */
export function createHttp(deps: HttpDeps = {}) {
  const base = (deps.baseUrl ?? '/api/v1').replace(/\/+$/, '');
  const doFetch = deps.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  let csrf: string | null = null;

  async function send(
    method: Method,
    path: string,
    body: unknown,
    extra?: Record<string, string>,
  ): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json', ...extra };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET' && csrf && !PRE_SESSION.has(path)) headers['X-CSRF-Token'] = csrf;
    return doFetch(`${base}${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }

  async function parseError(res: Response): Promise<ApiError> {
    const parsed = (await res.json().catch(() => null)) as ApiErrorBody | null;
    return new ApiError(res.status, parsed);
  }

  async function refreshCsrf(): Promise<void> {
    const res = await send('POST', '/admin/auth/csrf', {});
    if (!res.ok) throw await parseError(res);
    csrf = ((await res.json()) as { csrfToken: string }).csrfToken;
  }

  async function request<T>(
    method: Method,
    path: string,
    body?: unknown,
    options: RequestOptions = {},
  ): Promise<T> {
    const redirect = options.redirectOn401 ?? true;
    let csrfRetried = false;
    let stepUpRetried = false;
    if (method !== 'GET' && !csrf && !PRE_SESSION.has(path)) {
      try {
        await refreshCsrf();
      } catch (error) {
        if (error instanceof ApiError && error.status === 401 && redirect) {
          deps.onUnauthenticated?.();
        }
        throw error;
      }
    }
    for (;;) {
      const res = await send(method, path, body, options.headers);
      if (res.ok) {
        if (res.status === 204) return undefined as T;
        return (await res.json()) as T;
      }
      const error = await parseError(res);
      const code = error.body?.code;
      if (res.status === 403 && code === 'CSRF_FAILED' && !csrfRetried) {
        csrfRetried = true;
        await refreshCsrf();
        continue;
      }
      if (
        res.status === 403 &&
        code === 'STEP_UP_REQUIRED' &&
        !stepUpRetried &&
        deps.requestStepUp
      ) {
        stepUpRetried = true;
        if (await deps.requestStepUp()) continue;
      }
      if (res.status === 401 && redirect) deps.onUnauthenticated?.();
      throw error;
    }
  }

  return {
    get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, undefined, options),
    post: <T>(path: string, body: unknown = {}, options?: RequestOptions) =>
      request<T>('POST', path, body, options),
    put: <T>(path: string, body: unknown = {}, options?: RequestOptions) =>
      request<T>('PUT', path, body, options),
    patch: <T>(path: string, body: unknown, options?: RequestOptions) =>
      request<T>('PATCH', path, body, options),
    delete: <T>(path: string, options?: RequestOptions) =>
      request<T>('DELETE', path, undefined, options),
    /** Stores the token the server returned at sign-in or 2FA completion. */
    setCsrf(token: string | null) {
      csrf = token;
    },
    hasCsrf: () => csrf !== null,
  };
}

export type Http = ReturnType<typeof createHttp>;
