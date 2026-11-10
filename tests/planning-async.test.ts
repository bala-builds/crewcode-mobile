// Async planning boundary: the owner's AI task division runs through the same
// start/apply/discard discipline as task builds. Providers are injected fakes;
// no live key is wired.
import { describe, it, expect } from 'vitest';
import { seedState, createProject, joinProject } from '../src/core/store';
import * as Smod from '../src/core/store';
import { Api } from '../src/server/api';

const setup = () => {
  let s = seedState();
  const c = createProject(s, 'u-ram', 'Plan App', '# Plan app', ''); if (!c.ok) throw Error(c.error);
  s = c.state; const pid = c.projectId;
  const code = s.projects.find((x: any) => x.id === pid)!.team.code;
  const j = joinProject(s, 'u-seeta', code, ['frontend']); if (!j.ok) throw Error(j.error); s = j.state;
  return { s, pid };
};
const proj = (api: Api, pid: string) => api.state.projects.find((x: any) => x.id === pid)!;

describe('async planning boundary (delayed provider)', () => {
  it('stopping a delayed plan discards the late provider result: no tasks, no plan message', async () => {
    const { s, pid } = setup();
    let release: (v: any) => void = () => {};
    const deferred = new Promise<any>((r) => { release = r; });
    const api = new Api(s, () => {}, undefined, async () => deferred);
    const run = api.callAsync({ as: 'u-ram', op: 'assignTasks', args: { projectId: pid } });
    expect(proj(api, pid).planning).toBe(true);
    const cancel = api.call({ as: 'u-ram', op: 'cancelPlanning', args: { projectId: pid } });
    expect(cancel.ok).toBe(true);
    release({ ok: true, plan: [{ title: 'Late', detail: 'late', assigneeId: 'u-seeta', folder: 'home/' }] });
    const done = await run;
    expect(done.ok).toBe(true);
    expect((done as any).data.discarded).toBe(true);
    const p = proj(api, pid);
    expect(p.tasks.length).toBe(0); // no late task writes
    expect(p.messages.some((m: any) => m.kind === 'ai_plan')).toBe(false);
    expect(p.planning).toBe(false);
  });

  it('a second plan while planning is refused, and a failed provider is a retryable failure', async () => {
    const { s, pid } = setup();
    let release: (v: any) => void = () => {};
    const deferred = new Promise<any>((r) => { release = r; });
    const api = new Api(s, () => {}, undefined, async () => deferred);
    const run = api.callAsync({ as: 'u-ram', op: 'assignTasks', args: { projectId: pid } });
    const again = await api.callAsync({ as: 'u-ram', op: 'assignTasks', args: { projectId: pid } });
    expect(again.ok).toBe(false);
    expect((again as any).error).toContain('already running');
    release({ ok: false, error: 'Provider failed.' });
    const done = await run;
    expect(done.ok).toBe(true);
    const p = proj(api, pid);
    expect(p.planning).toBe(false);
    expect(p.tasks.length).toBe(0);
    expect(p.messages.some((m: any) => m.kind === 'ai_error' && m.text === 'Provider failed.')).toBe(true);
    const retry = await api.callAsync({ as: 'u-ram', op: 'assignTasks', args: { projectId: pid } });
    expect(retry.ok).toBe(true); // default deterministic planner on the fresh Api state? no - same fake
  });

  it('a teammate cannot start or stop planning', async () => {
    const { s, pid } = setup();
    const api = new Api(s);
    const r = await api.callAsync({ as: 'u-seeta', op: 'assignTasks', args: { projectId: pid } });
    expect(r.ok).toBe(false);
    expect(api.call({ as: 'u-seeta', op: 'cancelPlanning', args: { projectId: pid } }).ok).toBe(false);
  });

  it('the provider result is validated again at the boundary: a bad plan writes nothing', async () => {
    const { s, pid } = setup();
    const bad = [{ title: 'A', detail: 'a', assigneeId: 'u-seeta', folder: '../escape/' }];
    const api = new Api(s, () => {}, undefined, async () => ({ ok: true, plan: bad }));
    const r = await api.callAsync({ as: 'u-ram', op: 'assignTasks', args: { projectId: pid } });
    expect(r.ok).toBe(true);
    const p = proj(api, pid);
    expect(p.tasks.length).toBe(0);
    expect(p.messages.some((m: any) => m.kind === 'ai_error' && m.text.includes('rejected'))).toBe(true);
    expect(p.planning).toBe(false);
  });

  it('the default deterministic planner proposes through the async path; the owner approves', async () => {
    const { s, pid } = setup();
    const api = new Api(s);
    const r = await api.callAsync({ as: 'u-ram', op: 'assignTasks', args: { projectId: pid } });
    expect(r.ok).toBe(true);
    expect((r as any).data.count).toBe(1);
    let p = proj(api, pid);
    // Proposal only: no tasks until the owner approves.
    expect(p.tasks).toHaveLength(0);
    expect(p.proposedPlan![0].assigneeId).toBe('u-seeta');
    // A teammate can never approve.
    expect(Smod.confirmPlanning(api.state, pid, 'u-seeta', { accept: true }).ok).toBe(false);
    const ok = Smod.confirmPlanning(api.state, pid, 'u-ram', { accept: true });
    expect(ok.ok).toBe(true);
    api.state = (ok as any).state;
    p = proj(api, pid);
    expect(p.proposedPlan).toBeUndefined();
    expect(p.tasks[0].assigneeId).toBe('u-seeta');
    expect(p.messages.some((m: any) => m.kind === 'ai_plan')).toBe(true);
  });
});
