import type { Member, Task, Project, TestUser } from './types';

/**
 * SIMULATED AI. Deterministic, no network, no keys. It stands in for the owner's AI so the
 * task flow, scoping and validation can be built and tested. A real provider replaces `planTasks` later.
 */
export interface PlannedTask { title: string; detail: string; assigneeId: string; folder: string }

const AREAS: { key: string; folder: string; words: string[]; title: string; detail: string }[] = [
  { key: 'frontend', folder: 'frontend/', words: ['frontend', 'ui', 'screen', 'design', 'web', 'mobile'], title: 'Build the screens', detail: 'Lay out the main screens and wire them to the shared names in the contract.' },
  { key: 'backend', folder: 'backend/', words: ['backend', 'api', 'server', 'database', 'data'], title: 'Build the API', detail: 'Create the endpoints the screens need. Use API_BASE from the contract.' },
  { key: 'ai', folder: 'ai/', words: ['ai', 'prompt', 'agent', 'ml'], title: 'Build the AI features', detail: 'Write the prompts and the task flow for the AI parts of the app.' },
  { key: 'tests', folder: 'tests/', words: ['test', 'qa', 'quality'], title: 'Write tests', detail: 'Cover the main journeys and the access rules.' },
];

function areaFor(interests: string[]) {
  const hay = interests.join(' ').toLowerCase();
  return AREAS.find((a) => a.words.some((w) => hay.includes(w)));
}

export function planTasks(project: Pick<Project, 'name' | 'files' | 'members'>, users: TestUser[]): PlannedTask[] {
  const used = new Set<string>();
  const out: PlannedTask[] = [];
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? id;
  const free = AREAS.filter(() => true);
  for (const m of project.members) {
    let area = areaFor(m.interests);
    if (!area || used.has(area.folder)) area = free.find((a) => !used.has(a.folder));
    if (!area) {
      // More members than areas: give a personal folder so each folder still has exactly one owner.
      const folder = `${nameOf(m.userId).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-work/`;
      used.add(folder);
      out.push({ title: 'Take a feature from the owner', detail: 'The owner assigns the specific feature.', assigneeId: m.userId, folder });
      continue;
    }
    used.add(area.folder);
    const interest = m.interests[0] ? ` (matched to interest: ${m.interests[0]})` : '';
    out.push({ title: area.title, detail: area.detail + interest, assigneeId: m.userId, folder: area.folder });
  }
  return out;
}

export type ValidateResult = { ok: true } | { ok: false; errors: string[] };

/** Bad AI output is rejected, not saved. */
export function validatePlan(plan: PlannedTask[], members: Member[]): ValidateResult {
  const errors: string[] = [];
  const folders = new Map<string, string>();
  const ids = new Set(members.map((m) => m.userId));
  for (const t of plan) {
    if (!t.title.trim()) errors.push('A task has no title.');
    if (!ids.has(t.assigneeId)) errors.push(`Task "${t.title}" is assigned to someone who is not on the project.`);
    if (!t.folder.endsWith('/') || t.folder.startsWith('/') || t.folder.includes('..')) errors.push(`Task "${t.title}" has an invalid folder.`);
    const prev = folders.get(t.folder);
    if (prev !== undefined) errors.push(`Folder ${t.folder} is given to more than one task.`);
    folders.set(t.folder, t.assigneeId);
  }
  const perPerson = new Map<string, number>();
  for (const t of plan) perPerson.set(t.assigneeId, (perPerson.get(t.assigneeId) ?? 0) + 1);
  for (const m of members) if (!perPerson.has(m.userId)) errors.push('A member has no task.');
  return errors.length ? { ok: false, errors } : { ok: true };
}

export function toTasks(plan: PlannedTask[], newId: () => string): Task[] {
  return plan.map((p) => ({ id: newId(), title: p.title, detail: p.detail, assigneeId: p.assigneeId, folder: p.folder, status: 'todo' as const }));
}

/** Simulated build output for a task. Writes only inside the task folder. */
export function simulateBuild(task: Task, projectName: string): Record<string, string> {
  const f = task.folder;
  if (f === 'frontend/') {
    return {
      [`${f}index.html`]: `<!doctype html>\n<html><body style="font-family:sans-serif;margin:0;padding:24px">\n<h1>${projectName}</h1>\n<!-- @shared PROJECT_NAME -->\n<p>Simulated frontend preview.</p>\n<button onclick="document.body.style.background='#eef'">Tap me</button>\n</body></html>\n`,
    };
  }
  if (f === 'backend/') return { [`${f}server.ts`]: `// @shared API_BASE\nexport const routes = ['/health', '/items'];\n` };
  if (f === 'ai/') return { [`${f}prompts.md`]: `# Prompts\nUse PROJECT_NAME and keep answers short.\n` };
  if (f === 'tests/') return { [`${f}smoke.test.ts`]: `// Simulated test file\nexport {};\n` };
  return { [`${f}README.md`]: `# ${task.title}\n` };
}
