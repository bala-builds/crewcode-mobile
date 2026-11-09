import { describe, it, expect } from 'vitest';
import { buildTaskPrompt, parseBuildJson, deterministicBuild, deterministicProvider } from '../src/core/execution';
import { seedState, createProject, joinProject, assignTasks, runBuild, cancelTaskRun, setAiAccess } from '../src/core/store';

const task = { id: 't1', title: 'Build the screens', detail: 'Make the main screens.', assigneeId: 'u-seeta', folder: 'frontend/', status: 'todo' as const };
const project = { name: 'Scope App', files: { 'CONTRACT.md': '@shared API_BASE', 'frontend/index.html': '<h1>old</h1>', 'backend/secret.ts': 'hidden' } };

describe('provider execution boundary', () => {
  it('task prompt includes contract and folder files but no other folders', () => {
    const text = buildTaskPrompt(task, project, 'Change it').map((t) => t.content).join('\n');
    expect(text).toContain('API_BASE');
    expect(text).toContain('<h1>old</h1>');
    expect(text).not.toContain('hidden');
  });
  it('rejects malformed or out-of-folder build output without partial files', () => {
    expect(parseBuildJson('no', 'frontend/').ok).toBe(false);
    expect(parseBuildJson('{"message":"x","files":[]}', 'frontend/').ok).toBe(true);
    for (const raw of [
      '{"message":"x","files":[{"path":"backend/x.ts","content":"no"}]}',
      '{"message":"x","files":[{"path":"frontend/../secret","content":"no"}]}',
      '{"message":"x","files":[{"path":"frontend/x.ts"}]}',
    ]) expect(parseBuildJson(raw, 'frontend/').ok).toBe(false);
  });
  it('deterministic build stays in folder and is clearly simulated', () => {
    const out = deterministicBuild('App', 'frontend/', 'make it');
    expect(out.ok).toBe(true);
    if (out.ok) { expect(out.message).toContain('No live AI'); expect(Object.keys(out.files)).toEqual(['frontend/index.html']); }
  });
  it('provider-facing deterministic provider returns parseable output', async () => {
    const out = await deterministicProvider('App').complete([{ role: 'user', content: 'Assigned folder: frontend/\n\n## Request\nhi' }]);
    expect(out.ok).toBe(true);
    if (out.ok) expect(parseBuildJson(out.text, 'frontend/').ok).toBe(true);
  });
});

describe('task run state', () => {
  it('records thinking, failure, retry, prompt forwarding, and stop semantics', () => {
    let s = seedState();
    const c = createProject(s, 'u-ram', 'Runs', '# Runs app', ''); if (!c.ok) throw Error(c.error);
    s = c.state; const pid = c.projectId;
    const j = joinProject(s, 'u-seeta', s.projects.find((x: any) => x.id === pid)!.team.code, ['frontend']); if (!j.ok) throw Error(j.error); s = j.state;
    const ai = setAiAccess(s, pid, 'u-seeta', { kind: 'owner' }); if (!ai.ok) throw Error(ai.error); s = ai.state;
    const a = assignTasks(s, pid, 'u-ram'); if (!a.ok) throw Error(a.error); s = a.state;
    const tid = s.projects.find((x: any) => x.id === pid)!.tasks.find((t: any) => t.assigneeId === 'u-seeta')!.id;
    let seenPrompt = '';
    let failed = runBuild(s, pid, 'u-seeta', tid, { prompt: 'hello', build: () => ({ ok: false, error: 'Provider failed.' }) });
    if (!failed.ok) throw Error();
    expect(failed.state.projects.find((x: any) => x.id === pid)!.tasks[0].run).toBe('failed');
    expect(failed.state.projects.find((x: any) => x.id === pid)!.messages.at(-1)?.text).toContain('Provider failed.');
    const stopped = cancelTaskRun(failed.state, pid, 'u-seeta', tid);
    expect(stopped.ok).toBe(false); // cannot stop after failure
    const again = runBuild(failed.state, pid, 'u-seeta', tid, { prompt: 'hello', build: (_t, _p, prompt) => { seenPrompt = prompt; return { ok: true, message: 'done', files: { 'frontend/a.txt': 'x' } }; } });
    if (!again.ok) throw Error();
    expect(seenPrompt).toBe('hello');
    expect(again.state.projects.find((x: any) => x.id === pid)!.tasks[0].run).toBe('idle');
    expect(again.state.projects.find((x: any) => x.id === pid)!.files['frontend/a.txt']).toBe('x');
  });
});
