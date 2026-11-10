// PRD F6 + acceptance 9: before a teammate's work is merged, the owner runs the
// integration check; mismatches are reported and block the merge; edits after a clean
// check make the review stale and block the merge until the check is re-run.
import { describe, it, expect } from 'vitest';
import { saveFile, setTaskStatus, submitTaskForReview, runIntegrationReview, acceptTaskMerge } from '../src/core/store';
import { teamState, ok } from './helpers';
import type { AppState } from '../src/core/types';

function setup() {
  const { state, pid } = teamState();
  const taskOf = (s: AppState, uid: string) => {
    const t = s.projects.find((p) => p.id === pid)!.tasks.find((x) => x.assigneeId === uid);
    if (!t) throw new Error('no task for ' + uid);
    return t;
  };
  return { state, pid, taskOf };
}

describe('merge review (PRD F6, acceptance 9)', () => {
  it('only a done task can be submitted, and only by its assignee', () => {
    let { state, pid, taskOf } = setup();
    const id = taskOf(state, 'u-seeta').id;
    expect(submitTaskForReview(state, pid, 'u-seeta', id).ok).toBe(false);
    state = ok(setTaskStatus(state, pid, 'u-seeta', id, 'done')).state;
    expect(submitTaskForReview(state, pid, 'u-hanuma', id).ok).toBe(false);
    state = ok(submitTaskForReview(state, pid, 'u-seeta', id)).state;
    expect(taskOf(state, 'u-seeta').review?.state).toBe('submitted');
  });

  it('the owner runs the check and merges a clean folder; teammates cannot', () => {
    let { state, pid, taskOf } = setup();
    const id = taskOf(state, 'u-seeta').id;
    state = ok(setTaskStatus(state, pid, 'u-seeta', id, 'done')).state;
    state = ok(submitTaskForReview(state, pid, 'u-seeta', id)).state;
    expect(runIntegrationReview(state, pid, 'u-seeta', id).ok).toBe(false);
    state = ok(runIntegrationReview(state, pid, 'u-ram', id)).state;
    expect(taskOf(state, 'u-seeta').review?.state).toBe('ready');
    expect(acceptTaskMerge(state, pid, 'u-seeta', id).ok).toBe(false);
    state = ok(acceptTaskMerge(state, pid, 'u-ram', id)).state;
    expect(taskOf(state, 'u-seeta').review?.state).toBe('accepted');
    expect(submitTaskForReview(state, pid, 'u-seeta', id).ok).toBe(false);
    expect(runIntegrationReview(state, pid, 'u-ram', id).ok).toBe(false);
  });

  it('mismatches are reported with file and name and block the merge', () => {
    let { state, pid, taskOf } = setup();
    const id = taskOf(state, 'u-seeta').id;
    state = ok(saveFile(state, pid, 'u-seeta', 'home/index.html', '<p>@shared BOGUS_NAME</p>')).state;
    state = ok(setTaskStatus(state, pid, 'u-seeta', id, 'done')).state;
    state = ok(submitTaskForReview(state, pid, 'u-seeta', id)).state;
    state = ok(runIntegrationReview(state, pid, 'u-ram', id)).state;
    const r = taskOf(state, 'u-seeta').review!;
    expect(r.state).toBe('changes_requested');
    expect(r.findings.map((f) => `${f.name} in ${f.path}`)).toContain('BOGUS_NAME in home/index.html');
    const blocked = acceptTaskMerge(state, pid, 'u-ram', id);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toMatch(/mismatch/i);
  });

  it('edits after a clean check block the merge until the check is re-run', () => {
    let { state, pid, taskOf } = setup();
    const id = taskOf(state, 'u-seeta').id;
    state = ok(setTaskStatus(state, pid, 'u-seeta', id, 'done')).state;
    state = ok(submitTaskForReview(state, pid, 'u-seeta', id)).state;
    state = ok(runIntegrationReview(state, pid, 'u-ram', id)).state;
    state = ok(saveFile(state, pid, 'u-seeta', 'home/app.ts', 'export const x = 1;')).state;
    const stale = acceptTaskMerge(state, pid, 'u-ram', id);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error).toMatch(/changed since/i);
    state = ok(runIntegrationReview(state, pid, 'u-ram', id)).state;
    state = ok(acceptTaskMerge(state, pid, 'u-ram', id)).state;
    expect(taskOf(state, 'u-seeta').review?.state).toBe('accepted');
  });

  it('merging two teammates checks each folder and reports per-folder results', () => {
    let { state, pid, taskOf } = setup();
    const sId = taskOf(state, 'u-seeta').id;
    const hId = taskOf(state, 'u-hanuma').id;
    state = ok(saveFile(state, pid, 'u-hanuma', 'settings/api.ts', '// @shared SECRET_THING')).state;
    for (const [uid, id] of [['u-seeta', sId], ['u-hanuma', hId]] as const) {
      state = ok(setTaskStatus(state, pid, uid, id, 'done')).state;
      state = ok(submitTaskForReview(state, pid, uid, id)).state;
      state = ok(runIntegrationReview(state, pid, 'u-ram', id)).state;
    }
    expect(taskOf(state, 'u-hanuma').review?.state).toBe('changes_requested');
    state = ok(acceptTaskMerge(state, pid, 'u-ram', sId)).state;
    expect(taskOf(state, 'u-seeta').review?.state).toBe('accepted');
    expect(acceptTaskMerge(state, pid, 'u-ram', hId).ok).toBe(false);
  });

  it('a fix plus a fresh submit and check clears the mismatch and the merge goes through', () => {
    let { state, pid, taskOf } = setup();
    const id = taskOf(state, 'u-seeta').id;
    state = ok(saveFile(state, pid, 'u-seeta', 'home/index.html', '<p>@shared BOGUS_NAME</p>')).state;
    state = ok(setTaskStatus(state, pid, 'u-seeta', id, 'done')).state;
    state = ok(submitTaskForReview(state, pid, 'u-seeta', id)).state;
    state = ok(runIntegrationReview(state, pid, 'u-ram', id)).state;
    expect(taskOf(state, 'u-seeta').review?.state).toBe('changes_requested');
    state = ok(saveFile(state, pid, 'u-seeta', 'home/index.html', '<p>@shared PROJECT_NAME</p>')).state;
    state = ok(submitTaskForReview(state, pid, 'u-seeta', id)).state;
    state = ok(runIntegrationReview(state, pid, 'u-ram', id)).state;
    expect(taskOf(state, 'u-seeta').review?.state).toBe('ready');
    state = ok(acceptTaskMerge(state, pid, 'u-ram', id)).state;
    expect(taskOf(state, 'u-seeta').review?.state).toBe('accepted');
  });

  it('a contract edit after a clean check blocks the merge until re-checked', () => {
    let { state, pid, taskOf } = setup();
    const id = taskOf(state, 'u-seeta').id;
    state = ok(setTaskStatus(state, pid, 'u-seeta', id, 'done')).state;
    state = ok(submitTaskForReview(state, pid, 'u-seeta', id)).state;
    state = ok(runIntegrationReview(state, pid, 'u-ram', id)).state;
    expect(taskOf(state, 'u-seeta').review?.state).toBe('ready');
    const p = state.projects.find((x) => x.id === pid)!;
    state = ok(saveFile(state, pid, 'u-ram', 'CONTRACT.md', p.files['CONTRACT.md'] + '- EXTRA_NAME\n')).state;
    const stale = acceptTaskMerge(state, pid, 'u-ram', id);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error).toMatch(/changed since/i);
    state = ok(runIntegrationReview(state, pid, 'u-ram', id)).state;
    state = ok(acceptTaskMerge(state, pid, 'u-ram', id)).state;
    expect(taskOf(state, 'u-seeta').review?.state).toBe('accepted');
  });

  it('edits after a merge reopen the review instead of leaving a stale merged status', () => {
    let { state, pid, taskOf } = setup();
    const id = taskOf(state, 'u-seeta').id;
    state = ok(setTaskStatus(state, pid, 'u-seeta', id, 'done')).state;
    state = ok(submitTaskForReview(state, pid, 'u-seeta', id)).state;
    state = ok(runIntegrationReview(state, pid, 'u-ram', id)).state;
    state = ok(acceptTaskMerge(state, pid, 'u-ram', id)).state;
    expect(taskOf(state, 'u-seeta').review?.state).toBe('accepted');
    // A teammate edit inside the merged folder reopens the review.
    state = ok(saveFile(state, pid, 'u-seeta', 'home/app.ts', 'export const y = 2;')).state;
    expect(taskOf(state, 'u-seeta').review?.state).toBe('submitted');
    // Re-merge, then a contract edit reopens it too (the check depended on the contract).
    state = ok(runIntegrationReview(state, pid, 'u-ram', id)).state;
    state = ok(acceptTaskMerge(state, pid, 'u-ram', id)).state;
    expect(taskOf(state, 'u-seeta').review?.state).toBe('accepted');
    const p = state.projects.find((x) => x.id === pid)!;
    state = ok(saveFile(state, pid, 'u-ram', 'CONTRACT.md', p.files['CONTRACT.md'] + '- MORE_NAMES\n')).state;
    expect(taskOf(state, 'u-seeta').review?.state).toBe('submitted');
  });

  it('acceptance stores an immutable snapshot of the folder as merged', () => {
    let { state, pid, taskOf } = setup();
    const id = taskOf(state, 'u-seeta').id;
    state = ok(saveFile(state, pid, 'u-seeta', 'home/index.html', '<p>@shared PROJECT_NAME</p>')).state;
    state = ok(setTaskStatus(state, pid, 'u-seeta', id, 'done')).state;
    state = ok(submitTaskForReview(state, pid, 'u-seeta', id)).state;
    state = ok(runIntegrationReview(state, pid, 'u-ram', id)).state;
    state = ok(acceptTaskMerge(state, pid, 'u-ram', id)).state;
    expect(taskOf(state, 'u-seeta').review?.snapshot?.['home/index.html']).toBe('<p>@shared PROJECT_NAME</p>');
    // A later edit reopens the review; the old snapshot no longer stands as merged state.
    state = ok(saveFile(state, pid, 'u-seeta', 'home/index.html', '<p>changed</p>')).state;
    expect(taskOf(state, 'u-seeta').review?.state).toBe('submitted');
    expect(taskOf(state, 'u-seeta').review?.snapshot).toBeUndefined();
  });

  it('a resubmit after a clean check resets the review, so a merge without re-check is refused', () => {
    let { state, pid, taskOf } = setup();
    const id = taskOf(state, 'u-seeta').id;
    state = ok(setTaskStatus(state, pid, 'u-seeta', id, 'done')).state;
    state = ok(submitTaskForReview(state, pid, 'u-seeta', id)).state;
    state = ok(runIntegrationReview(state, pid, 'u-ram', id)).state;
    expect(taskOf(state, 'u-seeta').review?.state).toBe('ready');
    // the teammate submits again before the owner merges: the clean check must not carry over
    state = ok(submitTaskForReview(state, pid, 'u-seeta', id)).state;
    const r = acceptTaskMerge(state, pid, 'u-ram', id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Run the integration check');
  });

  it('a merge cannot be replayed, and merging before any check is refused', () => {
    let { state, pid, taskOf } = setup();
    const id = taskOf(state, 'u-seeta').id;
    state = ok(setTaskStatus(state, pid, 'u-seeta', id, 'done')).state;
    expect(acceptTaskMerge(state, pid, 'u-ram', id).ok).toBe(false);
    state = ok(submitTaskForReview(state, pid, 'u-seeta', id)).state;
    expect(acceptTaskMerge(state, pid, 'u-ram', id).ok).toBe(false);
    state = ok(runIntegrationReview(state, pid, 'u-ram', id)).state;
    state = ok(acceptTaskMerge(state, pid, 'u-ram', id)).state;
    expect(taskOf(state, 'u-seeta').review?.state).toBe('accepted');
    const r = acceptTaskMerge(state, pid, 'u-ram', id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('already merged');
    expect(taskOf(state, 'u-seeta').review?.state).toBe('accepted');
  });
});
