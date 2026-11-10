import { finishSignIn } from '../../../server/serverless';
import { envDeps, send, type ReqLike, type ResLike } from '../../../server/vercel-entry';
export default async function handler(req: ReqLike, res: ResLike) {
  if (req.method !== 'GET') return send(res, { status: 405, body: { ok: false, error: 'Use GET.' } });
  const url = new URL(req.url ?? '/', 'https://localhost');
  send(res, await finishSignIn(await envDeps(process.env), { code: url.searchParams.get('code') ?? undefined, state: url.searchParams.get('state') ?? undefined }, req.headers.cookie as string | undefined));
}
