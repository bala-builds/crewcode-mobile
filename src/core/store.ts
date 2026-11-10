import type { AppState, Project, ProviderLabel, AiAccess, Task, TaskStatus, ChatMessage } from './types';
import { PROVIDER_LABELS } from './types';
import { canAccess, isOwner, isMember } from './permissions';
import { findByCode, generateTeamCode } from './teamcode';
import { defaultContract, integrationCheck, folderFingerprint, reviewFingerprint } from './contract';
import { planTasks, validatePlan, toTasks, simulateBuild, type PlannedTask } from './orchestrator';
import { LOCAL_TOOL_HANDLERS } from './toolhandlers';
import { mcpCall } from './mcpclient';
import { CATALOG, skillCanAccess, localRunnable } from './skills';

export type Result<T = {}> = ({ ok: true; state: AppState } & T) | { ok: false; error: string };

let counter = 0;
export function newId(prefix: string) { counter += 1; return `${prefix}-${Date.now().toString(36)}${counter.toString(36)}`; }

const clone = <T,>(x: T): T => structuredClone(x);
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export const TEST_USERS = [
  { id: 'u-ram', name: 'Ram' },
  { id: 'u-seeta', name: 'Seeta' },
  { id: 'u-hanuma', name: 'Hanuma' },
  { id: 'u-outsider', name: 'Outsider' },
];

export function seedState(): AppState {
  const s: AppState = { users: clone(TEST_USERS), projects: [], currentUserId: null, version: 0 };
  const demo = createProjectRaw('u-ram', 'Habit Tracker', '# Habit Tracker\n\nA small app to track daily habits.\n\nFeatures:\n- Home: today\'s habits with an add button\n- Settings: reminders and preferences\n', 'Keep code simple. Use plain TypeScript. Do not touch files outside your folder.\n', 'DEM-123');
  demo.members.push({ userId: 'u-seeta', role: 'teammate', interests: ['frontend'], ai: { kind: 'owner' } });
  s.projects.push(demo);
  return s;
}

/** Team codes expire after this long; the owner regenerates to reopen joining (PRD B5). */
export const TEAM_CODE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function createProjectRaw(ownerId: string, name: string, prd: string, instructions: string, code?: string): Project {
  return {
    id: newId('p'), name, ownerId,
    team: { code: code ?? generateTeamCode(), revoked: false, expiresAt: Date.now() + TEAM_CODE_TTL_MS },
    members: [{ userId: ownerId, role: 'owner', interests: [], ai: { kind: 'owner' } }],
    files: { 'PRD.md': prd, 'AGENT_INSTRUCTIONS.md': instructions, 'CONTRACT.md': defaultContract(name) },
    fileRevs: { 'PRD.md': 0, 'AGENT_INSTRUCTIONS.md': 0, 'CONTRACT.md': 0 },
    tasks: [], messages: [], ownerKeySharing: true, skills: [],
  };
}

function mut(state: AppState, projectId: string, f: (p: Project) => string | void): Result {
  const next = clone(state);
  const p = next.projects.find((x) => x.id === projectId);
  if (!p) return fail('Project not found.');
  const err = f(p);
  if (err) return fail(err);
  return { ok: true, state: next };
}

export function signInAsTestUser(state: AppState, userId: string, name?: string): AppState {
  const next = clone(state);
  const trimmed = (name ?? '').trim();
  if (trimmed) { const u = next.users.find((x) => x.id === userId); if (u) u.name = trimmed; }
  next.currentUserId = userId;
  return next;
}

export function registerName(state: AppState, name: string): Result<{ userId: string }> {
  const n = name.trim();
  if (n.length < 2) return fail('Enter at least 2 characters.');
  if (n.length > 40) return fail('Keep the name under 40 characters.');
  const next = clone(state);
  const id = newId('u');
  next.users.push({ id, name: n });
  next.currentUserId = id;
  return { ok: true, state: next, userId: id };
}

// Real GitHub sign-in: find-or-create the account bound to the immutable GitHub
// user id. A changed login updates the label, never the binding.
export function upsertGithubUser(state: AppState, githubId: number, login: string): Result<{ userId: string }> {
  if (!Number.isInteger(githubId) || githubId <= 0) return fail('Bad GitHub user id.');
  const clean = login.trim().slice(0, 40);
  if (clean.length < 1) return fail('GitHub returned no login.');
  const existing = state.users.find((u) => u.githubId === githubId);
  if (existing) {
    if (existing.name === clean && existing.githubLogin === clean) return { ok: true, state, userId: existing.id };
    const next = clone(state);
    const u = next.users.find((x) => x.id === existing.id)!;
    u.name = clean; u.githubLogin = clean;
    return { ok: true, state: next, userId: existing.id };
  }
  const next = clone(state);
  const id = newId('u');
  next.users.push({ id, name: clean, githubId, githubLogin: clean });
  return { ok: true, state: next, userId: id };
}

export function createProject(state: AppState, userId: string, name: string, prd: string, instructions: string): Result<{ projectId: string }> {
  if (!state.users.some((u) => u.id === userId)) return fail('Unknown user.');
  if (name.trim().length < 2) return fail('Give the project a name.');
  if (prd.trim().length < 10) return fail('The master prompt or PRD is too short.');
  const next = clone(state);
  const p = createProjectRaw(userId, name.trim(), prd.trim() + '\n', instructions.trim() + '\n');
  next.projects.push(p);
  return { ok: true, state: next, projectId: p.id };
}

export function joinProject(state: AppState, userId: string, code: string, interests: string[]): Result<{ projectId: string }> {
  const r = findByCode(state.projects, code, userId);
  if (!r.ok) {
    const msg = { not_found: 'No project has that code.', revoked: 'That code was turned off by the owner.', expired: 'That code has expired.', already_member: 'You are already on this project.', used_up: 'That code has reached its join limit. Ask the owner to raise it or make a new code.' }[r.reason];
    return fail(msg);
  }
  const clean = interests.map((i) => i.trim()).filter(Boolean);
  if (clean.length === 0) return fail('Pick at least one interest.');
  const next = clone(state);
  const p = next.projects.find((x) => x.id === r.project.id)!;
  p.members.push({ userId, role: 'teammate', interests: clean });
  p.team.joinsUsed = (p.team.joinsUsed ?? 0) + 1;
  return { ok: true, state: next, projectId: p.id };
}

export function setAiAccess(state: AppState, projectId: string, userId: string, access: AiAccess): Result {
  return mut(state, projectId, (p) => {
    const m = p.members.find((x) => x.userId === userId);
    if (!m) return 'You are not on this project.';
    if (access.kind === 'owner') {
      if (m.role !== 'owner' && !p.ownerKeySharing) return 'The owner has turned off sharing their AI model.';
    } else if (!access.provider || !PROVIDER_LABELS.includes(access.provider as ProviderLabel)) return 'Pick a provider.';
    m.ai = access.kind === 'owner' ? { kind: 'owner' } : { kind: 'own', provider: access.provider };
  });
}

export function setOwnerKeySharing(state: AppState, projectId: string, userId: string, on: boolean): Result {
  return mut(state, projectId, (p) => {
    if (!isOwner(p, userId)) return 'Only the owner can change this.';
    p.ownerKeySharing = on;
    if (!on) for (const m of p.members) if (m.role !== 'owner' && m.ai?.kind === 'owner') m.ai = undefined; // takes effect at once
  });
}

export function regenerateCode(state: AppState, projectId: string, userId: string): Result {
  return mut(state, projectId, (p) => { if (!isOwner(p, userId)) return 'Only the owner can do this.'; p.team = { code: generateTeamCode(), revoked: false, expiresAt: Date.now() + TEAM_CODE_TTL_MS }; });
}
/** Owner sets the code's expiry in days from now, or null for no expiry. The code itself does not change. */
export function setTeamCodeExpiry(state: AppState, projectId: string, userId: string, days: number | null): Result {
  return mut(state, projectId, (p) => {
    if (!isOwner(p, userId)) return 'Only the owner can do this.';
    if (days !== null && (!Number.isFinite(days) || days < 1 || days > 365)) return 'Pick an expiry between 1 and 365 days, or no expiry.';
    p.team.expiresAt = days === null ? null : Date.now() + days * 24 * 60 * 60 * 1000;
  });
}

/** Owner sets how many teammates may join with the code, or null for no limit. No forced default cap. */
export function setTeamJoinLimit(state: AppState, projectId: string, userId: string, maxJoins: number | null): Result {
  return mut(state, projectId, (p) => {
    if (!isOwner(p, userId)) return 'Only the owner can do this.';
    if (maxJoins !== null && (!Number.isInteger(maxJoins) || maxJoins < 1 || maxJoins > 1000)) return 'Pick a join limit from 1 to 1000, or no limit.';
    p.team.maxJoins = maxJoins;
  });
}

export function revokeCode(state: AppState, projectId: string, userId: string): Result {
  return mut(state, projectId, (p) => { if (!isOwner(p, userId)) return 'Only the owner can do this.'; p.team.revoked = true; });
}
export function removeMember(state: AppState, projectId: string, userId: string, targetId: string): Result {
  return mut(state, projectId, (p) => {
    if (!isOwner(p, userId)) return 'Only the owner can remove people.';
    if (targetId === p.ownerId) return 'The owner cannot be removed.';
    p.members = p.members.filter((m) => m.userId !== targetId);
    p.tasks = p.tasks.filter((t) => t.assigneeId !== targetId);
  });
}

export type PlanOutcome = { ok: true; plan: PlannedTask[] } | { ok: false; error: string };

/** Marks planning as started. Refuses a concurrent second planning run (retry race guard). */
export function startPlanning(state: AppState, projectId: string, userId: string): Result {
  const p0 = state.projects.find((x) => x.id === projectId);
  if (!p0) return fail('Project not found.');
  if (!isOwner(p0, userId)) return fail("Only the owner's AI can assign tasks.");
  if (p0.planning) return fail('Planning is already running. Stop it before starting again.');
  const next = clone(state);
  next.projects.find((x) => x.id === projectId)!.planning = true;
  return { ok: true, state: next };
}

/**
 * Async boundary for planning: commits only if planning was not stopped meanwhile.
 * The provider result is never trusted - the plan is validated again here, and a stopped
 * run discards the result entirely (no tasks, no plan message).
 */
export function applyPlanning(state: AppState, projectId: string, outcome: PlanOutcome, opts: { simulated?: boolean } = {}): Result<{ count?: number; discarded?: true }> {
  const next = clone(state);
  const p = next.projects.find((x) => x.id === projectId);
  if (!p) return fail('Project not found.');
  if (!p.planning) return { ok: true, state: next, discarded: true };
  p.planning = false;
  const push = (m: Omit<ChatMessage, 'id' | 'at'>) => p.messages.push({ ...m, id: newId('m'), at: Date.now() });
  if (!outcome.ok) {
    push({ authorId: 'ai', taskId: null, kind: 'ai_error', text: outcome.error });
    return { ok: true, state: next };
  }
  const team = p.members.filter((m) => m.role === 'teammate'); // the owner already has the whole project
  const v = validatePlan(outcome.plan, team);
  if (!v.ok) {
    push({ authorId: 'ai', taskId: null, kind: 'ai_error', text: 'The plan was rejected: ' + v.errors.join(' ') });
    return { ok: true, state: next };
  }
  // The plan is a proposal only: the owner reviews (and can reassign or discard) before any
  // task exists. confirmPlanning is the only path that creates tasks from a proposal.
  p.proposedPlan = outcome.plan;
  const nm = (id: string) => next.users.find((u) => u.id === id)?.name ?? id;
  push({ authorId: 'ai', taskId: null, kind: 'ai_plan', simulated: opts.simulated !== false, text: ((opts.simulated ?? true) ? 'Proposed plan (simulated) - waiting for the owner:\n' : 'Proposed plan - waiting for the owner:\n') + outcome.plan.map((t) => `- ${t.folder} - ${t.title} (${nm(t.assigneeId)})`).join('\n') });
  return { ok: true, state: next, count: outcome.plan.length };
}

/** Owner reviews the proposed split: approve (optionally reassigning tasks first) or discard.
 *  Teammates can never approve a plan. Only approval creates tasks and rewrites the contract. */
export function confirmPlanning(state: AppState, projectId: string, userId: string, opts: { accept: boolean; reassign?: Record<number, string> }): Result<{ count?: number }> {
  const next = clone(state);
  const p = next.projects.find((x) => x.id === projectId);
  if (!p) return fail('Project not found.');
  if (!isOwner(p, userId)) return fail('Only the owner can approve or discard a plan.');
  const plan = p.proposedPlan;
  if (!plan) return fail('There is no proposed plan to review.');
  const push = (m: Omit<ChatMessage, 'id' | 'at'>) => p.messages.push({ ...m, id: newId('m'), at: Date.now() });
  if (!opts.accept) {
    p.proposedPlan = undefined;
    push({ authorId: 'ai', taskId: null, kind: 'ai_error', text: 'The owner discarded the proposed plan. No tasks were changed.' });
    return { ok: true, state: next };
  }
  const adjusted = plan.map((t, i) => ({ ...t, assigneeId: opts.reassign?.[i] ?? t.assigneeId }));
  const team = p.members.filter((m) => m.role === 'teammate');
  const v = validatePlan(adjusted, team);
  if (!v.ok) {
    push({ authorId: 'ai', taskId: null, kind: 'ai_error', text: 'The plan was rejected: ' + v.errors.join(' ') });
    return { ok: true, state: next };
  }
  p.proposedPlan = undefined;
  p.tasks = toTasks(adjusted, () => newId('t'));
  const nm = (id: string) => next.users.find((u) => u.id === id)?.name ?? id;
  push({ authorId: 'ai', taskId: null, kind: 'ai_plan', simulated: false, text: 'Plan approved by the owner:\n' + p.tasks.map((t) => `- ${t.folder} - ${t.title} (${nm(t.assigneeId)})`).join('\n') });
  // Contract folder ownership is updated by the owner's AI, not by teammates.
  p.files['CONTRACT.md'] = defaultContract(p.name, p.tasks.map((t) => ({ folder: t.folder, owner: nm(t.assigneeId) })));
  if (!p.fileRevs) p.fileRevs = {};
  p.fileRevs['CONTRACT.md'] = (p.fileRevs['CONTRACT.md'] ?? 0) + 1;
  reopenAcceptedReviews(p, 'CONTRACT.md');
  return { ok: true, state: next, count: p.tasks.length };
}

export function cancelPlanning(state: AppState, projectId: string, userId: string): Result {
  return mut(state, projectId, (p) => {
    if (!isOwner(p, userId)) return 'Only the owner can stop planning.';
    if (!p.planning) return 'No planning is running.';
    p.planning = false;
    p.messages.push({ id: newId('m'), authorId: 'ai', taskId: null, kind: 'ai_error', text: 'Planning stopped. No tasks were changed.', at: Date.now() });
  });
}

/** Synchronous composition used by tests and the demo seed: start, plan, apply. */
export function assignTasks(state: AppState, projectId: string, userId: string, planTasksFn: typeof planTasks = planTasks, simulated = true): Result<{ count: number }> {
  const started = startPlanning(state, projectId, userId);
  if (!started.ok) return started;
  const p0 = started.state.projects.find((x) => x.id === projectId)!;
  const team = p0.members.filter((m) => m.role === 'teammate');
  const plan = planTasksFn({ name: p0.name, files: p0.files, members: team }, started.state.users);
  const applied = applyPlanning(started.state, projectId, { ok: true, plan }, { simulated });
  if (!applied.ok) return applied;
  const confirmed = confirmPlanning(applied.state, projectId, userId, { accept: true });
  if (!confirmed.ok) return confirmed;
  return { ok: true, state: confirmed.state, count: confirmed.count ?? 0 };
}

export function postPrompt(state: AppState, projectId: string, userId: string, text: string, taskId: string | null): Result {
  if (!text.trim()) return fail('Type a message first.');
  return mut(state, projectId, (p) => {
    if (!isMember(p, userId)) return 'You are not on this project.';
    if (taskId) {
      const t = p.tasks.find((x) => x.id === taskId);
      if (!t || (t.assigneeId !== userId && !isOwner(p, userId))) return 'That task is not yours.';
    }
    p.messages.push({ id: newId('m'), authorId: userId, taskId, kind: 'prompt', text: text.trim(), at: Date.now() });
  });
}

export function fileRev(state: AppState, projectId: string, path: string): number {
  const p = state.projects.find((x) => x.id === projectId);
  return p?.fileRevs?.[path] ?? 0;
}

/**
 * Write a file through the Phase 4 permission function, with optimistic conflict handling (Phase 8).
 * Pass the revision you read; if the file changed since, the write is refused instead of
 * silently overwriting the other edit. Omit baseRev only when overwriting blindly is intended.
 */
export function saveFile(state: AppState, projectId: string, userId: string, path: string, content: string, baseRev?: number): Result {
  return mut(state, projectId, (p) => {
    if (!canAccess(p, userId, 'write', path)) return `You cannot edit ${path}. It is outside your folder.`;
    if (content.length > 200_000) return 'That file is too large.';
    if (!p.fileRevs) p.fileRevs = {}; // tolerate states saved before revisions existed
    const current = p.fileRevs[path] ?? 0;
    if (baseRev !== undefined && baseRev !== current) {
      return `Conflict: ${path} changed while you were editing. Your edit was not saved; reload and try again.`;
    }
    p.files[path] = content;
    p.fileRevs[path] = current + 1;
    reopenAcceptedReviews(p, path);
  });
}

export type BuildFn = (task: Task, project: Pick<Project, 'name' | 'files'>, prompt: string) => { ok: true; message: string; files: Record<string, string> } | { ok: false; error: string };

/** Marks a task run as started. Refuses a concurrent second run (retry race guard). */
export function startTaskRun(state: AppState, projectId: string, userId: string, taskId: string): Result {
  const next = clone(state);
  const p = next.projects.find((x) => x.id === projectId);
  if (!p) return fail('Project not found.');
  const t = p.tasks.find((x) => x.id === taskId);
  if (!t) return fail('Task not found.');
  if (t.assigneeId !== userId && !isOwner(p, userId)) return fail('That task is not yours.');
  if (t.run === 'thinking') return fail('That task is already running. Stop it or wait for it to finish.');
  const me = p.members.find((m) => m.userId === userId);
  if (!me?.ai) {
    t.run = 'failed'; t.runError = 'Choose an AI model first.';
    p.messages.push({ id: newId('m'), authorId: 'ai', taskId, kind: 'ai_error', text: 'Choose an AI model first (owner model or your own key).', at: Date.now() });
    return { ok: true, state: next };
  }
  t.run = 'thinking'; delete t.runError;
  return { ok: true, state: next };
}

/**
 * Applies a finished run. If the task was stopped while the provider was still working,
 * the result is discarded: no files change, no build message is posted. Late writes never land.
 */
/** Simple line diff: trim the common prefix/suffix, count what changed in between. */
function lineDiff(before: string, after: string): { added: number; removed: number } {
  const a = before === '' ? [] : before.split('\n'); const b = after === '' ? [] : after.split('\n');
  let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let j = 0; while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  return { removed: a.length - i - j, added: b.length - i - j };
}

export function applyTaskRun(
  state: AppState, projectId: string, taskId: string,
  result: { ok: true; message: string; files: Record<string, string> } | { ok: false; error: string },
  opts: { simulated?: boolean } = {},
): Result<{ discarded?: boolean }> {
  const next = clone(state);
  const p = next.projects.find((x) => x.id === projectId);
  if (!p) return fail('Project not found.');
  const t = p.tasks.find((x) => x.id === taskId);
  if (!t) return fail('Task not found.');
  if (t.run !== 'thinking') return { ok: true, state: next, discarded: true };
  const push = (m: Omit<ChatMessage, 'id' | 'at'>) => p.messages.push({ ...m, id: newId('m'), at: Date.now() });
  if (!result.ok) {
    t.run = 'failed'; t.runError = result.error;
    push({ authorId: 'ai', taskId, kind: 'ai_error', text: result.error });
    return { ok: true, state: next };
  }
  const written: string[] = [];
  const diff: Record<string, { added: number; removed: number }> = {};
  for (const [path, content] of Object.entries(result.files)) {
    // The AI acts for the task's assignee. It is held to the same rule as a person.
    if (!canAccess(p, t.assigneeId, 'write', path)) {
      t.run = 'failed'; t.runError = `Refused: ${path} is outside the task folder.`;
      push({ authorId: 'ai', taskId, kind: 'ai_error', text: `Refused: ${path} is outside the task folder.` });
      return { ok: true, state: next };
    }
    const before = p.files[path];
    if (before !== content) diff[path] = lineDiff(before ?? '', content);
    p.files[path] = content; written.push(path);
    if (!p.fileRevs) p.fileRevs = {};
    p.fileRevs[path] = (p.fileRevs[path] ?? 0) + 1;
    reopenAcceptedReviews(p, path);
  }
  t.status = 'in_progress'; t.run = 'idle'; delete t.runError;
  push({ authorId: 'ai', taskId, kind: 'ai_build', simulated: opts.simulated !== false, text: (opts.simulated === false || result.message.toLowerCase().includes('simulated') ? '' : 'Simulated build. ') + result.message, files: written, diff });
  return { ok: true, state: next };
}

/** Synchronous composition used by tests and the demo seed: start, run the build, apply. */
export function runBuild(
  state: AppState,
  projectId: string,
  userId: string,
  taskId: string,
  opts: { forceError?: boolean; prompt?: string; build?: BuildFn; simulated?: boolean } = {},
): Result {
  const started = startTaskRun(state, projectId, userId, taskId);
  if (!started.ok) return started;
  let s1 = started.state;
  if (opts.forceError) {
    const r = applyTaskRun(s1, projectId, taskId, { ok: false, error: 'Simulated error. Nothing was changed. You can retry.' });
    return r.ok ? { ok: true, state: r.state } : r;
  }
  const p = s1.projects.find((x) => x.id === projectId)!;
  const t = p.tasks.find((x) => x.id === taskId)!;
  const result = opts.build ? opts.build(t, { name: p.name, files: p.files }, opts.prompt ?? '') : { ok: true as const, message: `Simulated build finished for "${t.title}". No real AI was called.`, files: simulateBuild(t, p.name) };
  const applied = applyTaskRun(s1, projectId, taskId, result, { simulated: opts.simulated });
  return applied.ok ? { ok: true, state: applied.state } : applied;
}

export function cancelTaskRun(state: AppState, projectId: string, userId: string, taskId: string): Result {
  return mut(state, projectId, (p) => {
    const t = p.tasks.find((x) => x.id === taskId);
    if (!t) return 'Task not found.';
    if (t.assigneeId !== userId && !isOwner(p, userId)) return 'That task is not yours.';
    if (t.run !== 'thinking') return 'No run is active.';
    t.run = 'failed'; t.runError = 'Stopped before a result arrived.';
    p.messages.push({ id: newId('m'), authorId: 'ai', taskId, kind: 'ai_error', text: 'Stopped. Existing files were kept; nothing new was saved.', at: Date.now() });
  });
}

export function setTaskDetails(state: AppState, projectId: string, userId: string, taskId: string, d: { priority?: 'low' | 'medium' | 'high' | null; due?: string | null; acceptance?: string | null }): Result {
  return mut(state, projectId, (p) => {
    const t = p.tasks.find((x) => x.id === taskId);
    if (!t) return 'Task not found.';
    if (t.assigneeId !== userId && !isOwner(p, userId)) return 'That task is not yours.';
    if (d.priority !== undefined) {
      if (d.priority !== null && !['low', 'medium', 'high'].includes(d.priority)) return 'Unknown priority.';
      t.priority = d.priority ?? undefined;
    }
    if (d.due !== undefined) {
      if (d.due !== null) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d.due);
        if (!m) return 'Due date must be YYYY-MM-DD.';
        const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
        if (dt.getUTCFullYear() !== +m[1] || dt.getUTCMonth() !== +m[2] - 1 || dt.getUTCDate() !== +m[3]) return 'Due date must be a real calendar date.';
      }
      t.due = d.due ?? undefined;
    }
    if (d.acceptance !== undefined) t.acceptance = d.acceptance?.trim() || undefined;
  });
}

export function setTaskStatus(state: AppState, projectId: string, userId: string, taskId: string, status: TaskStatus): Result {
  return mut(state, projectId, (p) => {
    const t = p.tasks.find((x) => x.id === taskId);
    if (!t) return 'Task not found.';
    if (t.assigneeId !== userId && !isOwner(p, userId)) return 'That task is not yours.';
    t.status = status;
  });
}

/**
 * The assignee marks a done task ready to merge. The work stays a draft (unmerged) until
 * the owner runs the integration check and accepts it. Re-submitting after requested
 * changes resets the review so the owner checks the fixed source.
 */
/** A merged task must not silently keep its status: writing into its folder (or changing
 * the contract the check depended on) reopens the review as submitted for a fresh check. */
function reopenAcceptedReviews(p: Project, path: string) {
  for (const t of p.tasks) {
    if (t.review?.state !== 'accepted') continue;
    if (path === 'CONTRACT.md' || path.startsWith(t.folder)) {
      // Keep the merged record: main/ still holds that content, so the next merge can
      // refuse to silently overwrite a merged copy the owner changed.
      t.review = { state: 'submitted', findings: [], fingerprint: '', at: Date.now(), merged: t.review.merged };
    }
  }
}

export function submitTaskForReview(state: AppState, projectId: string, userId: string, taskId: string): Result {
  return mut(state, projectId, (p) => {
    const t = p.tasks.find((x) => x.id === taskId);
    if (!t) return 'Task not found.';
    if (t.assigneeId !== userId && !isOwner(p, userId)) return 'That task is not yours.';
    if (t.review?.state === 'accepted') return 'This task is already merged.';
    if (t.status !== 'done') return 'Mark the task done before submitting it for merge.';
    t.review = { state: 'submitted', findings: [], fingerprint: '', at: Date.now(), merged: t.review?.merged };
  });
}

/** Owner-only: run the contract check on the submitted folder and record the result. */
export function runIntegrationReview(state: AppState, projectId: string, userId: string, taskId: string): Result {
  return mut(state, projectId, (p) => {
    if (!isOwner(p, userId)) return 'Only the owner can run the integration check.';
    const t = p.tasks.find((x) => x.id === taskId);
    if (!t) return 'Task not found.';
    if (!t.review) return 'The teammate has not submitted this task yet.';
    if (t.review.state === 'accepted') return 'This task is already merged.';
    const findings = integrationCheck(p.files['CONTRACT.md'] ?? '', p.files, t.folder);
    t.review = { state: findings.length ? 'changes_requested' : 'ready', findings, fingerprint: reviewFingerprint(p.fileRevs ?? {}, t.folder), at: Date.now(), merged: t.review.merged };
  });
}

/**
 * Owner-only: accept the merge and copy the checked folder into the main folder (PRD F3/F6):
 * every file <folder>/<name> lands at main/<folder>/<name>, so accepted work from all
 * teammates combines into one owner-visible tree while drafts stay in teammate folders.
 * Refused while mismatches are open, and refused when the folder changed after the last
 * clean check (the review is stale and must be re-run). A merged copy the owner edited
 * since the last merge is never silently overwritten: the merge is refused unless the
 * owner passes force to replace it.
 */
export function acceptTaskMerge(state: AppState, projectId: string, userId: string, taskId: string, opts: { force?: boolean } = {}): Result {
  return mut(state, projectId, (p) => {
    if (!isOwner(p, userId)) return 'Only the owner can merge.';
    const t = p.tasks.find((x) => x.id === taskId);
    if (!t) return 'Task not found.';
    const r = t.review;
    if (!r || r.state === 'submitted') return 'Run the integration check before merging.';
    if (r.state === 'accepted') return 'This task is already merged.';
    if (r.state === 'changes_requested') return 'The integration check reported mismatches. They must be fixed and re-checked first.';
    if (r.fingerprint !== reviewFingerprint(p.fileRevs ?? {}, t.folder)) return 'The folder or the contract changed since the last check. Run the integration check again.';
    for (const dep of t.deps ?? []) {
      const dt = p.tasks.find((x) => x.folder === dep);
      if (!dt || dt.review?.state !== 'accepted') return `Depends on ${dep} - merge that feature first.`;
    }
    const snapshot: Record<string, string> = {};
    for (const [path, content] of Object.entries(p.files)) if (path.startsWith(t.folder)) snapshot[path] = content;
    if (!opts.force && r.merged) {
      const changed = Object.entries(r.merged).filter(([path, content]) => p.files[path] !== undefined && p.files[path] !== content).map(([path]) => path);
      if (changed.length) return `The merged copy ${changed.join(', ')} was changed after the last merge. It is kept; merge again with overwrite to replace it.`;
    }
    if (!p.fileRevs) p.fileRevs = {};
    const merged: Record<string, string> = {};
    for (const [path, content] of Object.entries(snapshot)) {
      const target = `main/${path}`;
      p.files[target] = content;
      p.fileRevs[target] = (p.fileRevs[target] ?? 0) + 1;
      merged[target] = content;
    }
    t.review = { ...r, state: 'accepted', at: Date.now(), snapshot, merged };
  });
}

export function addSkill(state: AppState, projectId: string, userId: string, skillId: string): Result {
  return mut(state, projectId, (p) => {
    if (!isMember(p, userId)) return 'You are not on this project.';
    if (!CATALOG.some((c) => c.id === skillId)) return 'Unknown item.';
    if (p.skills.some((s) => s.id === skillId)) return 'Already added.';
    p.skills.push({ id: skillId, addedBy: userId, approvedByOwner: isOwner(p, userId) });
  });
}
export function approveSkill(state: AppState, projectId: string, userId: string, skillId: string): Result {
  return mut(state, projectId, (p) => {
    if (!isOwner(p, userId)) return 'Only the owner can approve.';
    const s = p.skills.find((x) => x.id === skillId); if (!s) return 'Not found.'; s.approvedByOwner = true;
  });
}
export function removeSkill(state: AppState, projectId: string, userId: string, skillId: string): Result {
  return mut(state, projectId, (p) => {
    const s = p.skills.find((x) => x.id === skillId); if (!s) return 'Not found.';
    if (!isOwner(p, userId) && s.addedBy !== userId) return 'Only the owner or who added it can remove it.';
    p.skills = p.skills.filter((x) => x.id !== skillId);
  });
}

/**
 * Run an installed skill on one file. The skill acts for the member and passes the same
 * folder-scope gate as a person (skillCanAccess). Out-of-scope or unapproved: refused,
 * nothing runs, nothing is written. Deterministic and local - no network.
 */

/**
 * Run an installed skill on one file. The skill acts for the member and passes the same
 * folder-scope gate as a person (skillCanAccess). Out-of-scope or unapproved: refused,
 * nothing runs, nothing is written. Handlers run only inside the sandbox process (toolproc).
 */
export function runSkill(state: AppState, projectId: string, userId: string, skillId: string, path: string): Result<{ output: string }> {
  const p0 = state.projects.find((x) => x.id === projectId);
  if (!p0) return fail('Project not found.');
  if (!isMember(p0, userId)) return fail('You are not on this project.');
  const item = CATALOG.find((c) => c.id === skillId);
  if (!item) return fail('Unknown item.');
  if (!skillCanAccess(p0, userId, skillId, 'read', path)) {
    return fail(`Refused: ${item.label} cannot read ${path}. It is outside your scope or not approved.`);
  }
  const content = p0.files[path];
  if (content === undefined) return fail(`No file named ${path}.`);
  // Declared capabilities are enforced at run time: this build provides in-scope reads only.
  if (!localRunnable(item)) {
    return fail(`${item.label} declares capabilities this build does not provide (${item.caps.join(', ')}). It is listed but cannot run yet.`);
  }
  if (!LOCAL_TOOL_HANDLERS[skillId]) return fail(`${item.label} cannot run yet. It is listed but not runnable in this build.`);
  const ran = mcpCall(skillId, { content, contract: p0.files['CONTRACT.md'] ?? '', path });
  if (!ran.ok) return fail(ran.error);
  const r = mut(state, projectId, (p) => {
    p.messages.push({ id: newId('m'), authorId: 'ai', taskId: null, kind: 'system', at: Date.now(), text: `${item.label} (run by ${userId}): ${ran.output}` });
  });
  if (!r.ok) return r;
  return { ok: true, state: r.state, output: ran.output };
}

const KEY = 'crewcode-mobile-state-v1';
export function save(state: AppState, storage: Pick<Storage, 'setItem'> = localStorage) { storage.setItem(KEY, JSON.stringify(state)); }
export function load(storage: Pick<Storage, 'getItem'> = localStorage): AppState {
  try { const raw = storage.getItem(KEY); if (raw) { const s = JSON.parse(raw) as AppState; if (Array.isArray(s.projects) && Array.isArray(s.users)) return s; } } catch { /* fall through */ }
  return seedState();
      }
