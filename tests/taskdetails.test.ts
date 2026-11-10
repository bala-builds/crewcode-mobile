// Negative and validation coverage for setTaskDetails (priority, due, acceptance).
import { describe, it, expect } from 'vitest';
import { teamState, ok } from './helpers';
import { setTaskDetails } from '../src/core/store';

describe('setTaskDetails rules', () => {
  const { state, pid } = teamState();
  const p = state.projects[0];
  const seetaTask = p.tasks.find((t) => t.assigneeId === 'u-seeta')!;

  it('owner can set details on any task', () => {
    const r = ok(setTaskDetails(state, pid, 'u-ram', seetaTask.id, { priority: 'high', due: '2026-12-01', acceptance: 'Passes check' }));
    const t = r.state.projects[0].tasks.find((x) => x.id === seetaTask.id)!;
    expect(t.priority).toBe('high');
    expect(t.due).toBe('2026-12-01');
    expect(t.acceptance).toBe('Passes check');
  });
  it('assignee can set details on their own task', () => {
    expect(setTaskDetails(state, pid, 'u-seeta', seetaTask.id, { priority: 'low' }).ok).toBe(true);
  });
  it('another teammate cannot touch a task that is not theirs', () => {
    const r = setTaskDetails(state, pid, 'u-hanuma', seetaTask.id, { priority: 'low' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('That task is not yours.');
  });
  it('rejects unknown priority and malformed due dates', () => {
    const bad1 = setTaskDetails(state, pid, 'u-ram', seetaTask.id, { priority: 'urgent' as any });
    expect(bad1.ok).toBe(false);
    const bad2 = setTaskDetails(state, pid, 'u-ram', seetaTask.id, { due: 'Dec 1' });
    expect(bad2.ok).toBe(false);
    const bad3 = setTaskDetails(state, pid, 'u-ram', seetaTask.id, { due: '2026-13-99' as string });
    expect(bad3.ok).toBe(false); // real calendar dates only
    if (!bad3.ok) expect(bad3.error).toBe('Due date must be a real calendar date.');
  });
  it('clears fields with null and whitespace acceptance unsets', () => {
    const r = ok(setTaskDetails(state, pid, 'u-ram', seetaTask.id, { priority: null, due: null, acceptance: '   ' }));
    const t = r.state.projects[0].tasks.find((x) => x.id === seetaTask.id)!;
    expect(t.priority).toBeUndefined();
    expect(t.due).toBeUndefined();
    expect(t.acceptance).toBeUndefined();
  });
  it('unknown task id fails cleanly', () => {
    const r = setTaskDetails(state, pid, 'u-ram', 't-nope', { priority: 'low' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('Task not found.');
  });
});

describe('build result line counts', () => {
  it('ai_build messages carry per-file added/removed counts from the real previous content', async () => {
    const { state, pid } = teamState();
    const p = state.projects[0];
    const task = p.tasks.find((t) => t.assigneeId === 'u-seeta')!;
    const { runBuild } = await import('../src/core/store');
    // New file: every line added, none removed (an empty previous file has zero lines).
    const r1 = ok(runBuild(state, pid, 'u-seeta', task.id, { build: () => ({ ok: true as const, message: 'built', files: { [task.folder + 'index.html']: '<h1>hi</h1>\n<p>x</p>' } }) }));
    const m1 = r1.state.projects[0].messages.filter((m) => m.kind === 'ai_build').at(-1)!;
    expect(m1.diff?.[task.folder + 'index.html']).toEqual({ added: 2, removed: 0 });
    // A brand-new file counts every line as added, none removed.
    const r1b = ok(runBuild(r1.state, pid, 'u-seeta', task.id, { build: () => ({ ok: true as const, message: 'new file', files: { [task.folder + 'new.html']: 'a\nb\nc' } }) }));
    const m1b = r1b.state.projects[0].messages.filter((m) => m.kind === 'ai_build').at(-1)!;
    expect(m1b.diff?.[task.folder + 'new.html']).toEqual({ added: 3, removed: 0 });
    // Second build edits one line of two: 1 removed, 1 added.
    const r2 = ok(runBuild(r1b.state, pid, 'u-seeta', task.id, { build: () => ({ ok: true as const, message: 'built again', files: { [task.folder + 'index.html']: '<h1>hi</h1>\n<p>y</p>' } }) }));
    const m2 = r2.state.projects[0].messages.filter((m) => m.kind === 'ai_build').at(-1)!;
    expect(m2.diff?.[task.folder + 'index.html']).toEqual({ added: 1, removed: 1 });
  });
});
