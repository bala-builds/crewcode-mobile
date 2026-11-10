// Merging copies the checked folder into the main folder (PRD goal: code from different
// teammates fits together in the main folder; F6: only after the contract check).
// The main copy is owner-only; a merged copy the owner changed is never silently overwritten.
import { describe, it, expect } from 'vitest';
import { saveFile, setTaskStatus, submitTaskForReview, runIntegrationReview, acceptTaskMerge } from '../src/core/store';
import { canAccess } from '../src/core/permissions';
import { viewFor } from '../src/server/api';
import { teamState, ok } from './helpers';
import type { AppState } from '../src/core/types';

function setup() {
  const { state, pid } = teamState();
  const taskOf = (s: AppState, uid: string) => {
    const t = s.projects.find((p) => p.id === pid)!.tasks.find((x) => x.assigneeId === uid);
    if (!t) throw new Error('no task for ' + uid);
    return t;
  };
  const mergeReady = (s: AppState, uid: string) => {
    const id = taskOf(s, uid).id;
    let n = ok(setTaskStatus(s, pid, uid, id, 'done')).state;
    n = ok(submitTaskForReview(n, pid, uid, id)).state;
    n = ok(runIntegrationReview(n, pid, 'u-ram', id)).state;
    return n;
  };
  return { state, pid, taskOf, mergeReady };
}

describe('merge into the main folder', () => {
  it('accepting copies the folder files into main/<folder>/ with revisions and a merged record', () => {
    let { state, pid, taskOf, mergeReady } = setup();
    state = ok(saveFile(state, pid, 'u-seeta', 'home/index.html', '<p>@shared PROJECT_NAME</p>')).state;
    state = mergeReady(state, 'u-seeta');
    const id = taskOf(state, 'u-seeta').id;
    state = ok(acceptTaskMerge(state, pid, 'u-ram', id)).state;
    const p = state.projects.find((x) => x.id === pid)!;
    expect(p.files['main/home/index.html']).toBe('<p>@shared PROJECT_NAME</p>');
    expect(p.fileRevs['main/home/index.html']).toBe(1);
    const r = taskOf(state, 'u-seeta').review!;
    expect(r.state).toBe('accepted');
    expect(r.snapshot?.['home/index.html']).toBe('<p>@shared PROJECT_NAME</p>');
    expect(r.merged?.['main/home/index.html']).toBe('<p>@shared PROJECT_NAME</p>');
  });

  it('the main folder is owner-only: teammates cannot read or write it', () => {
    let { state, pid, mergeReady } = setup();
    state = ok(saveFile(state, pid, 'u-seeta', 'home/index.html', '<p>ok</p>')).state;
    state = mergeReady(state, 'u-seeta');
    const id = state.projects.find((x) => x.id === pid)!.tasks.find((t) => t.assigneeId === 'u-seeta')!.id;
    state = ok(acceptTaskMerge(state, pid, 'u-ram', id)).state;
    const p = state.projects.find((x) => x.id === pid)!;
    expect(canAccess(p, 'u-seeta', 'read', 'main/home/index.html')).toBe(false);
    expect(canAccess(p, 'u-seeta', 'write', 'main/home/index.html')).toBe(false);
    expect(canAccess(p, 'u-ram', 'read', 'main/home/index.html')).toBe(true);
    expect(canAccess(p, 'u-ram', 'write', 'main/home/index.html')).toBe(true);
    const seetaView = viewFor(p, 'u-seeta', state.users, 0);
    expect(Object.keys(seetaView.files)).not.toContain('main/home/index.html');
    const ownerView = viewFor(p, 'u-ram', state.users, 0);
    expect(ownerView.files['main/home/index.html']).toBe('<p>ok</p>');
  });

  it('two teammates merge into one shared main tree without overwriting each other', () => {
    let { state, pid, taskOf, mergeReady } = setup();
    state = ok(saveFile(state, pid, 'u-seeta', 'home/index.html', '<p>front</p>')).state;
    state = ok(saveFile(state, pid, 'u-hanuma', 'settings/api.ts', '// api')).state;
    state = mergeReady(state, 'u-seeta');
    state = mergeReady(state, 'u-hanuma');
    state = ok(acceptTaskMerge(state, pid, 'u-ram', taskOf(state, 'u-seeta').id)).state;
    state = ok(acceptTaskMerge(state, pid, 'u-ram', taskOf(state, 'u-hanuma').id)).state;
    const p = state.projects.find((x) => x.id === pid)!;
    expect(p.files['main/home/index.html']).toBe('<p>front</p>');
    expect(p.files['main/settings/api.ts']).toBe('// api');
  });

  it('a teammate fix re-merged overwrites an untouched main copy', () => {
    let { state, pid, taskOf, mergeReady } = setup();
    state = ok(saveFile(state, pid, 'u-seeta', 'home/index.html', '<p>v1</p>')).state;
    state = mergeReady(state, 'u-seeta');
    const id = taskOf(state, 'u-seeta').id;
    state = ok(acceptTaskMerge(state, pid, 'u-ram', id)).state;
    expect(state.projects.find((x) => x.id === pid)!.files['main/home/index.html']).toBe('<p>v1</p>');
    // Teammate edits: review reopens, the main copy still holds v1.
    state = ok(saveFile(state, pid, 'u-seeta', 'home/index.html', '<p>v2</p>')).state;
    expect(taskOf(state, 'u-seeta').review?.state).toBe('submitted');
    expect(state.projects.find((x) => x.id === pid)!.files['main/home/index.html']).toBe('<p>v1</p>');
    state = ok(submitTaskForReview(state, pid, 'u-seeta', id)).state;
    state = ok(runIntegrationReview(state, pid, 'u-ram', id)).state;
    state = ok(acceptTaskMerge(state, pid, 'u-ram', id)).state;
    const p = state.projects.find((x) => x.id === pid)!;
    expect(p.files['main/home/index.html']).toBe('<p>v2</p>');
    expect(p.fileRevs['main/home/index.html']).toBe(2);
  });

  it('an owner edit to the merged copy blocks the next merge until the owner overwrites explicitly', () => {
    let { state, pid, taskOf, mergeReady } = setup();
    state = ok(saveFile(state, pid, 'u-seeta', 'home/index.html', '<p>v1</p>')).state;
    state = mergeReady(state, 'u-seeta');
    const id = taskOf(state, 'u-seeta').id;
    state = ok(acceptTaskMerge(state, pid, 'u-ram', id)).state;
    // Owner hand-edits the merged copy.
    state = ok(saveFile(state, pid, 'u-ram', 'main/home/index.html', '<p>owner fix</p>')).state;
    // Teammate ships v2; review reopens and passes again.
    state = ok(saveFile(state, pid, 'u-seeta', 'home/index.html', '<p>v2</p>')).state;
    state = ok(submitTaskForReview(state, pid, 'u-seeta', id)).state;
    state = ok(runIntegrationReview(state, pid, 'u-ram', id)).state;
    const refused = acceptTaskMerge(state, pid, 'u-ram', id);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toContain('main/home/index.html was changed after the last merge');
    // Nothing was overwritten.
    expect(state.projects.find((x) => x.id === pid)!.files['main/home/index.html']).toBe('<p>owner fix</p>');
    // A teammate can never force it; the owner overwrites explicitly.
    expect(acceptTaskMerge(state, pid, 'u-seeta', id, { force: true }).ok).toBe(false);
    state = ok(acceptTaskMerge(state, pid, 'u-ram', id, { force: true })).state;
    const p = state.projects.find((x) => x.id === pid)!;
    expect(p.files['main/home/index.html']).toBe('<p>v2</p>');
    expect(taskOf(state, 'u-seeta').review?.merged?.['main/home/index.html']).toBe('<p>v2</p>');
  });

  it('force does not bypass the staleness rule: a folder edit after the check still blocks the merge', () => {
    let { state, pid, taskOf, mergeReady } = setup();
    state = ok(saveFile(state, pid, 'u-seeta', 'home/index.html', '<p>v1</p>')).state;
    state = mergeReady(state, 'u-seeta');
    const id = taskOf(state, 'u-seeta').id;
    state = ok(acceptTaskMerge(state, pid, 'u-ram', id)).state;
    state = ok(saveFile(state, pid, 'u-seeta', 'home/index.html', '<p>v2</p>')).state;
    state = ok(submitTaskForReview(state, pid, 'u-seeta', id)).state;
    state = ok(runIntegrationReview(state, pid, 'u-ram', id)).state;
    // Edit after the clean check: even a forced merge is refused until re-checked.
    state = ok(saveFile(state, pid, 'u-seeta', 'home/index.html', '<p>v3</p>')).state;
    const refused = acceptTaskMerge(state, pid, 'u-ram', id, { force: true });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toMatch(/changed since/i);
    state = ok(runIntegrationReview(state, pid, 'u-ram', id)).state;
    state = ok(acceptTaskMerge(state, pid, 'u-ram', id)).state;
    expect(state.projects.find((x) => x.id === pid)!.files['main/home/index.html']).toBe('<p>v3</p>');
  });
});
