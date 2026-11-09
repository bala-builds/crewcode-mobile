import type { ChatTurn, LlmProvider } from './llm';
import type { Member, Project, TestUser } from './types';
import { validatePlan, type PlannedTask } from './orchestrator';

/**
 * Phase 6 prompt construction and structured-output handling.
 * Provider-agnostic: works with the mock provider now and a real one later.
 * Nothing is saved unless the parsed plan passes validatePlan.
 */

const MASTER_PROMPT = [
  'You are the owner AI of a CrewCode project.',
  'Divide the work described in the PRD into one task per team member.',
  'Match tasks to member interests where possible.',
  'Rules:',
  '- Every task has exactly one assignee and exactly one folder.',
  '- No two tasks share a folder.',
  '- Folders are relative paths ending in / and must not contain ..',
  '- Reply with ONLY a JSON array, no prose: [{"title":string,"detail":string,"assignee":string,"folder":string}]',
  '- "assignee" must be one of the member names listed below.',
].join('\n');

export function buildPlanningPrompt(
  project: Pick<Project, 'name' | 'files' | 'members'>,
  users: TestUser[],
): ChatTurn[] {
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? id;
  const roster = project.members
    .map((m) => `- ${nameOf(m.userId)} (${m.role})${m.interests.length ? `, interests: ${m.interests.join(', ')}` : ''}`)
    .join('\n');
  const prd = project.files['PRD.md'] ?? '';
  const instructions = project.files['AGENT_INSTRUCTIONS.md'] ?? '';
  const contract = project.files['CONTRACT.md'] ?? '';
  return [
    { role: 'system', content: MASTER_PROMPT },
    {
      role: 'user',
      content: [
        `Project: ${project.name}`,
        '',
        '## PRD', prd,
        '', '## Agent instructions', instructions,
        '', '## Shared contract', contract,
        '', '## Team', roster,
      ].join('\n'),
    },
  ];
}

export type ParseResult = { ok: true; plan: PlannedTask[] } | { ok: false; error: string };

/** Strictly parse raw model output into a plan. Bad output is rejected, never partially kept. */
export function parsePlanJson(raw: string, members: Member[], users: TestUser[] = []): ParseResult {
  const byName = new Map(members.map((m) => [m.userId, m.userId]));
  for (const m of members) {
    const name = users.find((u) => u.id === m.userId)?.name;
    if (name) byName.set(name.toLowerCase(), m.userId);
  }
  const trimmed = raw.trim();
  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return { ok: false, error: 'The AI reply did not contain a JSON array.' };
  let data: unknown;
  try {
    data = JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return { ok: false, error: 'The AI reply was not valid JSON.' };
  }
  if (!Array.isArray(data) || data.length === 0) return { ok: false, error: 'The AI reply was not a non-empty array.' };
  const plan: PlannedTask[] = [];
  for (const item of data) {
    if (typeof item !== 'object' || item === null) return { ok: false, error: 'A task entry was not an object.' };
    const o = item as Record<string, unknown>;
    if (typeof o.title !== 'string' || typeof o.detail !== 'string' || typeof o.assignee !== 'string' || typeof o.folder !== 'string') {
      return { ok: false, error: 'A task entry was missing title, detail, assignee or folder as strings.' };
    }
    const assigneeId = byName.get(o.assignee) ?? byName.get(o.assignee.toLowerCase()) ?? o.assignee;
    plan.push({ title: o.title, detail: o.detail, assigneeId, folder: o.folder });
  }
  return { ok: true, plan };
}

export type PlanOutcome =
  | { ok: true; plan: PlannedTask[] }
  | { ok: false; error: string };

/** Full Phase 6 flow: prompt -> provider -> parse -> validate. Invalid output is rejected, not saved. */
export async function planWithProvider(
  provider: LlmProvider,
  project: Pick<Project, 'name' | 'files' | 'members'>,
  users: TestUser[],
): Promise<PlanOutcome> {
  const res = await provider.complete(buildPlanningPrompt(project, users));
  if (!res.ok) return { ok: false, error: res.error };
  const parsed = parsePlanJson(res.text, project.members, users);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const v = validatePlan(parsed.plan, project.members);
  if (!v.ok) return { ok: false, error: `The AI plan was rejected: ${v.errors.join(' ')}` };
  return { ok: true, plan: parsed.plan };
}

/**
 * Per-task prompt for one teammate's AI. Contains only that teammate's task,
 * the shared contract and that task's folder. Never another teammate's task.
 */
export function buildTaskPrompt(
  project: Pick<Project, 'name' | 'files'>,
  task: PlannedTask,
): ChatTurn[] {
  const contract = project.files['CONTRACT.md'] ?? '';
  return [
    {
      role: 'system',
      content: [
        'You are a teammate AI on a CrewCode project.',
        'Work only on the task below and write only inside your folder.',
        'Use the shared names from the contract so the parts fit together.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `Project: ${project.name}`,
        '',
        '## Shared contract', contract,
        '',
        `## Your task: ${task.title}`, task.detail,
        '',
        `## Your folder: ${task.folder}`,
      ].join('\n'),
    },
  ];
}
