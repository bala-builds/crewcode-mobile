// Spawns the local Needle suggestion sidecar (scripts/needle-suggest.py) with a
// hard timeout. The sidecar proposes ONE tool call as JSON; it never executes.
import { spawn } from 'child_process';

export function runSuggestionSidecar(text: string, projectId: string, tasks: { id: string; title: string; assigneeId: string | null }[] = []): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let out = '', done = false;
    const finish = (v: Record<string, unknown>) => { if (!done) { done = true; resolve(v); } };
    const child = spawn('python3', ['scripts/needle-suggest.py', projectId, JSON.stringify(tasks)], { stdio: ['pipe', 'pipe', 'ignore'] });
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish({ none: 'suggestion timed out' }); }, 25000);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.on('error', () => { clearTimeout(timer); finish({ none: 'suggestion sidecar failed to start' }); });
    child.on('close', () => {
      clearTimeout(timer);
      try { finish(JSON.parse(out.trim().split('\n').pop() || '{}')); }
      catch { finish({ none: 'suggestion output was not JSON' }); }
    });
    child.stdin.write(text);
    child.stdin.end();
  });
}
