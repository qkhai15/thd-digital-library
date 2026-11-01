import { fileURLToPath } from 'node:url';
import path from 'node:path';

export async function checkOperationsHealth(fetcher = fetch) {
  const base = 'https://thuvien.tranhungdaothanhxuan-hanoi.edu.vn';
  const checks = [];
  for (const pathname of ['/', '/api/health']) {
    const start = performance.now();
    const response = await fetcher(base + pathname, { method: 'GET', signal: AbortSignal.timeout(15000) });
    if (response.status !== 200) throw new Error('Production health non-200.');
    if (pathname === '/api/health') {
      const body = await response.json();
      if (body.ok !== true || body.database !== 'connected' || Object.keys(body).some(key => !['ok','database','time'].includes(key))) throw new Error('Essential DB health invalid.');
    } else await response.body?.cancel();
    checks.push({ path: pathname, status: response.status, elapsedMs: Math.round(performance.now() - start), cacheControl: response.headers.get('cache-control') });
  }
  return { checkedAt: new Date().toISOString(), result: 'PASS', checks };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await checkOperationsHealth())); }
  catch { console.error('Production health check failed; private details suppressed.'); process.exitCode = 1; }
}
