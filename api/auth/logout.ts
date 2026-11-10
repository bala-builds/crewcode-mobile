import { logout } from '../../server/serverless';
import { envDeps, send, type ReqLike, type ResLike } from '../../server/vercel-entry';
export default async function handler(req: ReqLike, res: ResLike) {
  if (req.method !== 'POST') return send(res, { status: 405, body: { ok: false, error: 'Use POST.' } });
  send(res, await logout(await envDeps(process.env), req.headers.cookie as string | undefined));
}
