/** Sandbox runner entry: reads one job on stdin, runs the named handler, writes one JSON line. */
import { LOCAL_TOOL_HANDLERS } from '../core/toolhandlers';

const chunks: Buffer[] = [];
process.stdin.on('data', (c: Buffer) => chunks.push(c));
process.stdin.on('end', () => {
  try {
    const { handler, content, contract, path: p } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const fn = LOCAL_TOOL_HANDLERS[handler];
    if (!fn) { console.log(JSON.stringify({ ok: false, error: 'unknown handler' })); return; }
    console.log(JSON.stringify({ ok: true, output: fn(content, contract, p) }));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  }
});
