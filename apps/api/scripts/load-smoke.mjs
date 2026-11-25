// Small load smoke for the login and authorization paths. Local use only.
// Usage: node scripts/load-smoke.mjs [baseUrl] [requestsPerScenario] [concurrency]
// It sends unauthenticated and wrong-credential requests (random addresses, so no real account is
// touched) and reports latency percentiles and the status codes seen. It is a smoke test, not a
// benchmark: it shows that the guard, validation and rate limiting stay fast and fail closed.
const base = (process.argv[2] ?? 'http://localhost:4000').replace(/\/$/, '');
const total = Number(process.argv[3] ?? 200);
const concurrency = Number(process.argv[4] ?? 10);

if (new URL(base).hostname !== 'localhost' && new URL(base).hostname !== '127.0.0.1') {
  console.error('Refusing to run against a non-local host.');
  process.exit(1);
}

const scenarios = {
  'health (public)': () => fetch(`${base}/api/v1/health`),
  'admin route without session (expect 401)': () => fetch(`${base}/api/v1/admin/brands`),
  'admin login, unknown user (expect 401/429)': () =>
    fetch(`${base}/api/v1/admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3001' },
      body: JSON.stringify({
        email: `smoke-${Math.random().toString(36).slice(2)}@matilda.test`,
        password: crypto.randomUUID(),
      }),
    }),
  'forged brand header without session (expect 401)': () =>
    fetch(`${base}/api/v1/admin/me/context`, { headers: { 'X-Admin-Brand': 'not-a-brand' } }),
};

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

for (const [name, run] of Object.entries(scenarios)) {
  const times = [];
  const codes = {};
  let next = 0;
  const started = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next++ < total) {
        const t0 = performance.now();
        try {
          const res = await run();
          await res.arrayBuffer();
          codes[res.status] = (codes[res.status] ?? 0) + 1;
        } catch {
          codes.error = (codes.error ?? 0) + 1;
        }
        times.push(performance.now() - t0);
      }
    }),
  );
  times.sort((a, b) => a - b);
  const seconds = (performance.now() - started) / 1000;
  process.stdout.write(
    `${name}\n  ${total} requests, ${concurrency} at a time, ${(total / seconds).toFixed(0)} req/s` +
      ` | p50 ${percentile(times, 50).toFixed(0)} ms, p95 ${percentile(times, 95).toFixed(0)} ms,` +
      ` max ${times[times.length - 1].toFixed(0)} ms | statuses ${JSON.stringify(codes)}\n`,
  );
}
