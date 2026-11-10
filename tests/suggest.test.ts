// Suggestion proposals are validated for shape only and never executed by the
// suggestion path; consequential approvals are not suggestible at all.
import { describe, it, expect } from 'vitest';
import { validateProposal, validateProposalContext, resolveProjectTarget, describeProposal } from '../src/core/suggest';

describe('suggestion validation', () => {
  it('accepts a well-formed allowlisted proposal', () => {
    const r = validateProposal({ op: 'assignTasks', args: { projectId: 'p1' } });
    expect(r.ok && r.proposal.op).toBe('assignTasks');
  });
  it('approval ops are NOT suggestible: a model accept flag (incl. inverted) is rejected outright', () => {
    expect(validateProposal({ op: 'confirmPlanning', args: { projectId: 'p1', accept: true } }).ok).toBe(false);
    expect(validateProposal({ op: 'confirmPlanning', args: { projectId: 'p1', accept: false } }).ok).toBe(false);
    expect(validateProposal({ op: 'acceptTaskMerge', args: { projectId: 'p1', taskId: 't1' } }).ok).toBe(false);
  });
  it('rejects unknown ops, unknown args, wrong types, empty and oversized strings', () => {
    expect(validateProposal({ op: 'deleteEverything', args: {} }).ok).toBe(false);
    expect(validateProposal({ op: 'runBuild', args: { projectId: 'p1', taskId: 't1', extra: 1 } }).ok).toBe(false);
    expect(validateProposal({ op: 'runBuild', args: { projectId: 1, taskId: 't1' } }).ok).toBe(false);
    expect(validateProposal({ op: 'createProject', args: { name: '', prd: 'x' } }).ok).toBe(false);
    expect(validateProposal({ op: 'createProject', args: { name: 'x'.repeat(201), prd: 'x' } }).ok).toBe(false);
    expect(validateProposal('assignTasks').ok).toBe(false);
    expect(validateProposal(null).ok).toBe(false);
  });
  it('consequence text is plain language and honest about gates', () => {
    expect(describeProposal({ op: 'assignTasks', args: { projectId: 'p1' } })).toContain('owner approves');
    expect(describeProposal({ op: 'createProject', args: { name: 'Habits', prd: 'x' } })).toContain('Habits');
  });
});

describe('validateProposalContext (stale context, existence, role)', () => {
  const ctx = { projectId: 'p1', isOwner: false, tasks: [{ id: 't1', assigneeId: 'u-seeta' }] };
  it('rejects a proposal for a different project (stale context)', () => {
    const r = validateProposalContext({ op: 'runBuild', args: { projectId: 'p-old', taskId: 't1' } }, ctx, 'u-seeta');
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatch(/different project/);
  });
  it('rejects a task that does not exist', () => {
    const r = validateProposalContext({ op: 'runBuild', args: { projectId: 'p1', taskId: 't9' } }, ctx, 'u-seeta');
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatch(/does not exist/);
  });
  it('rejects a task that is not yours (wrong role)', () => {
    const r = validateProposalContext({ op: 'runBuild', args: { projectId: 'p1', taskId: 't1' } }, ctx, 'u-hanuma');
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatch(/not yours/);
  });
  it('accepts the assignee, and the owner for any task', () => {
    expect(validateProposalContext({ op: 'runBuild', args: { projectId: 'p1', taskId: 't1' } }, ctx, 'u-seeta').ok).toBe(true);
    expect(validateProposalContext({ op: 'runBuild', args: { projectId: 'p1', taskId: 't1' } }, { ...ctx, isOwner: true }, 'u-ram').ok).toBe(true);
  });
  it('goes stale when the task is deleted after the suggestion', () => {
    const p = { op: 'runBuild', args: { projectId: 'p1', taskId: 't1' } };
    expect(validateProposalContext(p, ctx, 'u-seeta').ok).toBe(true);
    const stale = { ...ctx, tasks: [] };
    const r = validateProposalContext(p, stale, 'u-seeta');
    expect(r.ok).toBe(false);
  });
  it('rejects assignTasks for a non-owner', () => {
    const r = validateProposalContext({ op: 'assignTasks', args: { projectId: 'p1' } }, ctx, 'u-seeta');
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatch(/owner/);
  });
});

describe('resolveProjectTarget (normalization never retargets explicit intent)', () => {
  const others = [{ id: 'p-other', name: 'Shopping List' }];
  it('normalizes model-invented project ids to the current project', () => {
    const r = resolveProjectTarget('t1', 'p1', 'build task t-abc', others);
    expect(r.ok).toBe(true); if (r.ok) expect(r.projectId).toBe('p1');
  });
  it('rejects when the command explicitly names another project by name', () => {
    const r = resolveProjectTarget('p1', 'p1', 'build the cart task in shopping list', others);
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatch(/Shopping List/);
  });
  it('rejects when the command explicitly types a different project id', () => {
    const r = resolveProjectTarget('p-other', 'p1', 'build task t-abc in p-other', others);
    expect(r.ok).toBe(false);
  });
  it('missing or matching project id binds to current project', () => {
    expect(resolveProjectTarget(undefined, 'p1', 'build it', others)).toEqual({ ok: true, projectId: 'p1' });
    expect(resolveProjectTarget('p1', 'p1', 'build it', others)).toEqual({ ok: true, projectId: 'p1' });
  });
});
