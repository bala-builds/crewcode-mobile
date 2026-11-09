/**
 * Local deterministic tool handlers, bundled into the sandbox runner (toolproc).
 * Each receives only the single in-scope file content (and the contract for checks).
 * Registered probes exist only when CREWCODE_PROBE=1, for sandbox boundary tests.
 */
import { scanForKeys } from './keysafety';

/**
 * Local deterministic tool handlers. Each receives only the single in-scope file content
 * (and the contract for checks) - no project, no network, no writes. That is the whole
 * runtime for now; anything needing more is refused by the capability check above.
 */
export const LOCAL_TOOL_HANDLERS: Record<string, (content: string, contract: string, path: string) => string> = {
  'code-review': (content, contract, path) => {
    const lines = content.split('\n').length;
    const shared = [...content.matchAll(/@shared\s+(\w+)/g)].map((m) => m[1]);
    const missing = shared.filter((n) => !contract.includes(n));
    return `Review of ${path}: ${lines} lines. ` +
      (shared.length ? `Shared names used: ${shared.join(', ')}.` : 'No shared names used.') +
      (missing.length ? ` Not in the contract: ${missing.join(', ')}.` : ' All shared names match the contract.');
  },
  'cloudflare-security': (content, _contract, path) => {
    const found = scanForKeys(content);
    return found.length
      ? `Security scan of ${path}: ${found.length} possible secret(s) found and masked: ${found.join(', ')}. Remove them.`
      : `Security scan of ${path}: no keys or secrets found.`;
  },
  'docs-mcp': (content, _contract, path) => {
    const headings = content.split('\n').filter((l) => l.trim().startsWith('#')).map((l) => l.trim());
    const lines = content.split('\n').length;
    return `Outline of ${path}: ${lines} lines. ` + (headings.length ? `Headings: ${headings.join(' | ')}` : 'No headings found.');
  },
};

if (process.env.CREWCODE_PROBE === '1') {
  LOCAL_TOOL_HANDLERS['__probe_fs'] = () => {
    let fsr = 'FS-OPEN'; let cp = 'CP-OPEN'; let wk = 'WK-OPEN';
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs: typeof import('node:fs') = require('node:fs');
      fs.readFileSync('/etc/hostname');
    } catch (e) { if (e instanceof Error && /restricted|denied/i.test(e.message)) fsr = 'FS-DENIED'; else fsr = 'FS-ERR:' + String(e).split('\n')[0]; }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const c: typeof import('node:child_process') = require('node:child_process');
      c.execSync('true');
    } catch (e) { if (e instanceof Error && /restricted|denied/i.test(e.message)) cp = 'CP-DENIED'; else cp = 'CP-ERR:' + String(e).split('\n')[0]; }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const w: typeof import('node:worker_threads') = require('node:worker_threads');
      new w.Worker('1', { eval: true });
    } catch (e) { if (e instanceof Error && /restricted|denied/i.test(e.message)) wk = 'WK-DENIED'; else wk = 'WK-ERR:' + String(e).split('\n')[0]; }
    return `probe: ${fsr} ${cp} ${wk}`;
  };
  LOCAL_TOOL_HANDLERS['__probe_hang'] = () => { for (;;) { /* never returns */ } };
}
