import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHttp } from './http-core.ts';

interface Call {
  url: string;
  method: string;
  csrf: string | null;
  body: string | undefined;
}

function fakeServer(script: Array<{ status: number; body?: unknown }>) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      csrf: headers.get('x-csrf-token'),
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    const next = script.shift();
    assert.ok(next, `unexpected request ${String(input)}`);
    return new Response(next.status === 204 ? null : JSON.stringify(next.body ?? {}), {
      status: next.status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { calls, fetchImpl };
}

test('fetches a CSRF token before the first mutation and sends it', async () => {
  const s = fakeServer([
    { status: 200, body: { csrfToken: 't1' } },
    { status: 200, body: { ok: 1 } },
  ]);
  const http = createHttp({ fetchImpl: s.fetchImpl });
  assert.deepEqual(await http.post('/admin/things', { a: 1 }), { ok: 1 });
  assert.equal(s.calls[0]?.url, '/api/v1/admin/auth/csrf');
  assert.equal(s.calls[1]?.csrf, 't1');
  assert.equal(s.calls[1]?.body, '{"a":1}');
});

test('needs no CSRF token for login and sends none', async () => {
  const s = fakeServer([{ status: 200, body: { next: 'MFA_VERIFY', csrfToken: 'c' } }]);
  const http = createHttp({ fetchImpl: s.fetchImpl });
  await http.post('/admin/auth/login', { email: 'a', password: 'b' }, { redirectOn401: false });
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0]?.csrf, null);
});

test('refreshes a rejected CSRF token and retries exactly once', async () => {
  const s = fakeServer([
    { status: 403, body: { code: 'CSRF_FAILED' } },
    { status: 200, body: { csrfToken: 'fresh' } },
    { status: 204 },
  ]);
  const http = createHttp({ fetchImpl: s.fetchImpl });
  http.setCsrf('stale');
  await http.post('/admin/things');
  assert.deepEqual(
    s.calls.map((c) => c.csrf),
    ['stale', null, 'fresh'],
  );

  const again = fakeServer([
    { status: 403, body: { code: 'CSRF_FAILED' } },
    { status: 200, body: { csrfToken: 'x' } },
    { status: 403, body: { code: 'CSRF_FAILED' } },
  ]);
  const h2 = createHttp({ fetchImpl: again.fetchImpl });
  h2.setCsrf('stale');
  await assert.rejects(() => h2.post('/admin/things'), { status: 403 });
});

test('opens step-up on STEP_UP_REQUIRED and retries once when it succeeds', async () => {
  const s = fakeServer([
    { status: 403, body: { code: 'STEP_UP_REQUIRED' } },
    { status: 200, body: { done: true } },
  ]);
  let asked = 0;
  const http = createHttp({
    fetchImpl: s.fetchImpl,
    requestStepUp: async () => {
      asked += 1;
      return true;
    },
  });
  http.setCsrf('c');
  assert.deepEqual(await http.post('/admin/things'), { done: true });
  assert.equal(asked, 1);
});

test('surfaces the error when step-up is cancelled', async () => {
  const s = fakeServer([{ status: 403, body: { code: 'STEP_UP_REQUIRED' } }]);
  const http = createHttp({ fetchImpl: s.fetchImpl, requestStepUp: async () => false });
  http.setCsrf('c');
  await assert.rejects(() => http.post('/admin/things'), { status: 403 });
});

test('signals an ended session on 401, except on credential screens', async () => {
  let ended = 0;
  const s = fakeServer([
    { status: 401, body: { code: 'UNAUTHENTICATED' } },
    { status: 401, body: {} },
  ]);
  const http = createHttp({ fetchImpl: s.fetchImpl, onUnauthenticated: () => (ended += 1) });
  await assert.rejects(() => http.get('/admin/me'), { status: 401 });
  assert.equal(ended, 1);
  await assert.rejects(() => http.get('/admin/auth/session', { redirectOn401: false }), {
    status: 401,
  });
  assert.equal(ended, 1);
});
