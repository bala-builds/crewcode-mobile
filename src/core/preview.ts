/**
 * In-app full-stack preview (v1, deliberately bounded).
 *
 * What runs: a feature folder's index.html plus its api.ts, when api.ts is a PLAIN-JS
 * route module (no TypeScript-only syntax, no imports, no npm packages) exporting
 *   async function handle({ method, path, body }) -> { status, body }
 * The page's fetch() calls whose URL starts with /api are intercepted by an injected shim,
 * relayed through the parent window to a second sandboxed iframe that runs api.ts, and the
 * response travels back the same way. Everything is in-memory: no persistence, no env, no fs.
 *
 * What this is NOT: not a multi-language runtime, not a server, not a security boundary.
 * Other languages, package dependencies, databases and long-running processes need the
 * runtime roadmap (see docs); they are not claimed here.
 */
export const API_PREFIX = '/api';

/** Shim inlined ahead of the page's own scripts: fetch('/api...') is answered by the feature backend. */
export const FETCH_SHIM = `<script>(function(){
  const realFetch = window.fetch ? window.fetch.bind(window) : null;
  let next = 1; const pending = new Map();
  window.addEventListener('message', (e) => {
    const d = e.data; if (!d || d.__cc !== 'api-res') return;
    const p = pending.get(d.id); if (!p) return; pending.delete(d.id);
    p({ ok: d.status >= 200 && d.status < 300, status: d.status, json: async () => d.body, text: async () => JSON.stringify(d.body) });
  });
  window.fetch = (url, opts) => {
    const u = String(url);
    if (!u.startsWith('${API_PREFIX}')) return realFetch ? realFetch(url, opts) : Promise.reject(new Error('network unavailable'));
    const id = next++;
    return new Promise((res) => {
      pending.set(id, res);
      parent.postMessage({ __cc: 'api-req', id, method: (opts && opts.method) || 'GET', path: u, body: opts && opts.body ? JSON.parse(opts.body) : undefined }, '*');
    });
  };
})();</script>`;

/** Preview document: the page file with the fetch shim ahead of its scripts. */
export function buildPreviewDoc(html: string): string {
  return FETCH_SHIM + html;
}

/** Backend document: the feature's api.ts (plain JS) plus the request listener. */
export function buildBackendDoc(apiSrc: string): string {
  return `<script type="module">
${apiSrc}
const fn = typeof handle === 'function' ? handle : async () => ({ status: 501, body: { error: 'api.ts must export async function handle({ method, path, body })' } });
addEventListener('message', async (e) => {
  const d = e.data; if (!d || d.__cc !== 'api-run') return;
  try { const r = await fn({ method: d.method, path: d.path, body: d.body }); parent.postMessage({ __cc: 'api-res', id: d.id, status: r.status ?? 200, body: r.body }, '*'); }
  catch (err) { parent.postMessage({ __cc: 'api-res', id: d.id, status: 500, body: { error: String(err) } }, '*'); }
});
</script>`;
}

/** The backend module that serves a previewed page: <folder>api.ts next to index.html. */
export function backendPathFor(pagePath: string): string {
  const i = pagePath.lastIndexOf('/');
  return (i === -1 ? '' : pagePath.slice(0, i + 1)) + 'api.ts';
}
