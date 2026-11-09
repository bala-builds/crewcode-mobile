/**
 * Sandbox runner bridge. Local tool handlers never run in this process: each run spawns
 * a separate Node process under the runtime permission model, which ENFORCES:
 *  - no filesystem reads outside the runner bundle itself (--allow-fs-read scoped)
 *  - no filesystem writes, no child processes, no worker threads (denied by default)
 * Network is NOT runtime-enforced on this Node version: handlers are vetted in-repo code
 * that receives only data strings, and a hostile-handler network guarantee would need an
 * OS-level mechanism. That boundary is stated in DECISIONS.md, not claimed here.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const RUNNER = path.resolve('dist-tools/runner-entry.js');
const PKG = path.resolve('package.json');
const TIMEOUT_MS = 3000;

export function runToolInSandbox(handler: string, content: string, contract: string, filePath: string): { ok: true; output: string } | { ok: false; error: string } {
  try {
    const out = execFileSync(process.execPath, [
      '--experimental-permission',
      `--allow-fs-read=${path.dirname(RUNNER)}`,
      `--allow-fs-read=${PKG}`,
      RUNNER,
    ], {
      input: JSON.stringify({ handler, content, contract, path: filePath }),
      encoding: 'utf8',
      timeout: TIMEOUT_MS,
      env: process.env.CREWCODE_PROBE === '1' ? { CREWCODE_PROBE: '1' } : {},
      maxBuffer: 1024 * 1024,
    });
    const r = JSON.parse(out.trim().split('\n').pop() ?? '');
    return r.ok ? { ok: true, output: r.output } : { ok: false, error: r.error || 'Tool failed.' };
  } catch (e) {
    const msg = e instanceof Error && 'signal' in e && (e as { signal?: string }).signal ? 'Tool timed out or was stopped.' : (e instanceof Error ? e.message : String(e));
    return { ok: false, error: `Tool run failed: ${msg.split('\n')[0]}` };
  }
}
