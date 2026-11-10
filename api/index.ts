import { apiPost } from '../server/serverless';
import { envDeps, readJsonBody, send, type ReqLike, type ResLike } from '../server/vercel-entry';
export const config = { api: { bodyParser: false } };
export default async function handler(req: ReqLike, res: ResLike) {
  if (req.method !== 'POST') return send(res, { status: 405, body: { ok: false, error: 'Use POST.' } });
  const body = await readJsonBody(req);
  if (!body.ok) return send(res, { status: body.status, body: { ok: false, error: body.error } });
  send(res, await apiPost(await envDeps(process.env), req.headers.cookie as string | undefined, body.input));
}
