import { getApi } from '@/lib/api';

// Always evaluated per request so the build never depends on a running API.
export const dynamic = 'force-dynamic';

async function loadApiStatus(): Promise<string> {
  try {
    const health = await getApi().health({ cache: 'no-store' });
    return `${health.service} ${health.version}: ${health.status}`;
  } catch {
    return 'unreachable';
  }
}

// Phase 1 foundation only: no design work is authorized yet.
export default async function Home() {
  const apiStatus = await loadApiStatus();
  return (
    <main>
      <h1>Matilda Commerce Admin</h1>
      <p>Foundation (Phase 1). API status: {apiStatus}</p>
    </main>
  );
}
