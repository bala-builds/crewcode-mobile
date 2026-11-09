import type { AppState, Project, ProviderLabel, AiAccess, Task, TaskStatus, ChatMessage } from './types';
import { PROVIDER_LABELS } from './types';
import { canAccess, isOwner, isMember } from './permissions';
import { findByCode, generateTeamCode } from './teamcode';
import { defaultContract } from './contract';
import { planTasks, validatePlan, toTasks, simulateBuild } from './orchestrator';
import { CATALOG, skillCanAccess } from './skills';
import { scanForKeys } from './keysafety';

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
  const s: AppState = { users: clone(TEST_USERS), projects: [], currentUserId: null };
  const demo = createProjectRaw('u-ram', 'Habit Tracker', '# Habit Tracker\n\nA small app to track daily habits. Home screen with today\'s habits, a streak counter and an add button.\n', 'Keep code simple. Use plain TypeScript. Do not touch files outside your folder.\n', 'DEM-123');
  demo.members.push({ userId: 'u-seeta', role: 'teammate', interests: ['frontend'], ai: { kind: 'owner' } });
  s.projects.push(demo);
  return s;
}

function createProjectRaw(ownerId: string, name: string, prd: string, instructions: string, code?: string): Project {
  return {
    id: newId('p'), name, ownerId,
    team: { code: code ?? generateTeamCode(), revoked: false, expiresAt: null },
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
    const msg = { not_found: 'No project has that code.', revoked: 'That code was turned off by the owner.', expired: 'That code has expired.', already_member: 'You are already on this project.' }[r.reason];
    return fail(msg);
  }
  const clean = interests.map((i) => i.trim()).filter(Boolean);
  if (clean.length === 0) return fail('Pick at least one interest.');
  const next = clone(state);
  const p = next.projects.find((x) => x.id === r.project.id)!;
  p.members.push({ userId, role: 'teammate', interests: clean });
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
  return mut(state, projectId, (p) => { if (!isOwner(p, userId)) return 'Only the owner can do this.'; p.team = { code: generateTeamCode(), revoked: false, expiresAt: null }; });
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

export function assignTasks(state: AppState, projectId: string, userId: string, planTasksFn: typeof planTasks = planTasks, simulated = true): Result<{ count: number }> {
  const p0 = state.projects.find((x) => x.id === projectId);
  if (!p0) return fail('Project not found.');
  if (!isOwner(p0, userId)) return fail('Only the owner\'s AI can assign tasks.');
  const team = p0.members.filter((m) => m.role === 'teammate'); // the owner already has the whole project
  const plan = planTasksFn({ name: p0.name, files: p0.files, members: team }, state.users);
  const v = validatePlan(plan, team);
  if (!v.ok) return fail('The plan was rejected: ' + v.errors.join(' '));
  const next = clone(state);
  const p = next.projects.find((x) => x.id === projectId)!;
  p.tasks = toTasks(plan, () => newId('t'));
  const nm = (id: string) => next.users.find((u) => u.id === id)?.name ?? id;
  p.messages.push({ id: newId('m'), authorId: 'ai', taskId: null, kind: 'ai_plan', at: Date.now(), text: (simulated ? 'Simulated plan:\n' : 'Plan:\n') + p.tasks.map((t) => `${t.folder} - ${t.title} (${nm(t.assigneeId)})`).join('\n') });
  // Contract folder ownership is updated by the owner's AI, not by teammates.
  p.files['CONTRACT.md'] = defaultContract(p.name, p.tasks.map((t) => ({ folder: t.folder, owner: nm(t.assigneeId) })));
  return { ok: true, state: next, count: p.tasks.length };
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
  });
}

export function runBuild(
  state: AppState,
  projectId: string,
  userId: string,
  taskId: string,
  opts: { forceError?: boolean; prompt?: string; build?: (task: Task, project: Pick<Project, 'name' | 'files'>, prompt: string) => { ok: true; message: string; files: Record<string, string> } | { ok: false; error: string }; simulated?: boolean } = {},
): Result {
  const next = clone(state);
  const p = next.projects.find((x) => x.id === projectId);
  if (!p) return fail('Project not found.');
  const t = p.tasks.find((x) => x.id === taskId);
  if (!t) return fail('Task not found.');
  if (t.assigneeId !== userId && !isOwner(p, userId)) return fail('That task is not yours.');
  const me = p.members.find((m) => m.userId === userId);
  const push = (m: Omit<ChatMessage, 'id' | 'at'>) => p.messages.push({ ...m, id: newId('m'), at: Date.now() });
  t.run = 'thinking'; delete t.runError;
  if (!me?.ai) { t.run = 'failed'; t.runError = 'Choose an AI model first.'; push({ authorId: 'ai', taskId, kind: 'ai_error', text: "Choose an AI model first (owner model or your own key)." }); return { ok: true, state: next }; }
  if (opts.forceError) { t.run = 'failed'; t.runError = 'Simulated error.'; push({ authorId: 'ai', taskId, kind: 'ai_error', text: 'Simulated error. Nothing was changed. You can retry.' }); return { ok: true, state: next }; }
  const result = opts.build ? opts.build(t, { name: p.name, files: p.files }, opts.prompt ?? '') : { ok: true as const, message: `Simulated build finished for "${t.title}". No real AI was called.`, files: simulateBuild(t, p.name) };
  if (!result.ok) { t.run = 'failed'; t.runError = result.error; push({ authorId: 'ai', taskId, kind: 'ai_error', text: result.error }); return { ok: true, state: next }; }
  const written: string[] = [];
  for (const [path, content] of Object.entries(result.files)) {
    // The AI acts for the task's assignee. It is held to the same rule as a person.
    if (!canAccess(p, t.assigneeId, 'write', path)) { t.run = 'failed'; t.runError = `Refused: ${path} is outside the task folder.`; push({ authorId: 'ai', taskId, kind: 'ai_error', text: `Refused: ${path} is outside the task folder.` }); return { ok: true, state: next }; }
    p.files[path] = content; written.push(path);
    if (!p.fileRevs) p.fileRevs = {};
    p.fileRevs[path] = (p.fileRevs[path] ?? 0) + 1;
  }
  t.status = 'in_progress'; t.run = 'idle'; delete t.runError;
  push({ authorId: 'ai', taskId, kind: 'ai_build', text: (opts.simulated === false ? '' : 'Simulated build. ') + result.message, files: written });
  return { ok: true, state: next };
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

export function setTaskStatus(state: AppState, projectId: string, userId: string, taskId: string, status: TaskStatus): Result {
  return mut(state, projectId, (p) => {
    const t = p.tasks.find((x) => x.id === taskId);
    if (!t) return 'Task not found.';
    if (t.assigneeId !== userId && !isOwner(p, userId)) return 'That task is not yours.';
    t.status = status;
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
  let output: string;
  if (skillId === 'code-review') {
    const lines = content.split('\n').length;
    const shared = [...content.matchAll(/@shared\s+(\w+)/g)].map((m) => m[1]);
    const contract = p0.files['CONTRACT.md'] ?? '';
    const missing = shared.filter((n) => !contract.includes(n));
    output = `Review of ${path}: ${lines} lines. ` +
      (shared.length ? `Shared names used: ${shared.join(', ')}.` : 'No shared names used.') +
      (missing.length ? ` Not in the contract: ${missing.join(', ')}.` : ' All shared names match the contract.');
  } else if (skillId === 'cloudflare-security') {
    const found = scanForKeys(content);
    output = found.length
      ? `Security scan of ${path}: ${found.length} possible secret(s) found and masked: ${found.join(', ')}. Remove them.`
      : `Security scan of ${path}: no keys or secrets found.`;
  } else {
    return fail(`${item.label} cannot run yet. It is listed but not runnable in this build.`);
  }
  const r = mut(state, projectId, (p) => {
    p.messages.push({ id: newId('m'), authorId: 'ai', taskId: null, kind: 'system', at: Date.now(), text: `${item.label} (run by ${userId}): ${output}` });
  });
  if (!r.ok) return r;
  return { ok: true, state: r.state, output };
}

const KEY = 'crewcode-mobile-state-v1';
export function save(state: AppState, storage: Pick<Storage, 'setItem'> = localStorage) { storage.setItem(KEY, JSON.stringify(state)); }
export function load(storage: Pick<Storage, 'getItem'> = localStorage): AppState {
  try { const raw = storage.getItem(KEY); if (raw) { const s = JSON.parse(raw) as AppState; if (Array.isArray(s.projects) && Array.isArray(s.users)) return s; } } catch { /* fall through */ }
  return seedState();
}
