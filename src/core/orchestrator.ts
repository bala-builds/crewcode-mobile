import type { Member, Task, Project, TestUser } from './types';

/**
 * FEATURE-BASED decomposition. The unit of ownership is a feature (a page, a service or a
 * capability): each task owns one feature end to end - its screens and its backend together
 * in one folder. Frontend and backend of the same feature are never split across people.
 *
 * The deterministic local planner is intentionally shallow: it reads candidate features
 * from the PRD's list and balances them across the team by a rough size estimate (list-line
 * length), greedily assigning each feature in PRD order to the least-loaded teammate.
 * Dependency hints in a bullet ("depends on X", "after X") are copied into the task detail
 * as text only - ordering is NOT enforced anywhere. Real workload estimation and dependency
 * reasoning need the provider path (owner key, approval-gated). The plan is applied as soon
 * as it is produced; there is no owner review/edit step for the split yet.
 */
export interface PlannedTask { title: string; detail: string; assigneeId: string; folder: string }

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'feature';
}

/** Candidate features from a PRD: bullet or numbered list items ("- Home page: ..."). */
export function extractFeatures(prd: string): string[] {
  const out: string[] = [];
  for (const raw of prd.split('\n')) {
    const m = raw.trim().match(/^(?:[-*+]|\d+[.)])\s+(.+)$/);
    if (!m) continue;
    const name = m[1].split(/[:\u2013\u2014]/)[0].split(' - ')[0].trim();
    if (name.length >= 2 && name.length <= 60 && !out.includes(name)) out.push(name);
  }
  return out;
}

interface Feature { name: string; size: number; deps: string[] }

/** List items with a rough size (line length) and textual dependency hints. */
function featureDetails(prd: string): Feature[] {
  const out: Feature[] = [];
  for (const raw of prd.split('\n')) {
    const m = raw.trim().match(/^(?:[-*+]|\d+[.)])\s+(.+)$/);
    if (!m) continue;
    const line = m[1].trim();
    const name = line.split(/[:\u2013\u2014]/)[0].split(' - ')[0].trim();
    if (name.length < 2 || name.length > 60 || out.some((f) => f.name === name)) continue;
    out.push({ name, size: line.length, deps: [] });
  }
  // Dependency hints: "depends on X" / "after X" naming another listed feature.
  for (const f of out) {
    for (const other of out) {
      if (other === f) continue;
      const re = new RegExp('(?:depends on|after)\\s+' + other.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
      // The bullet text is re-read from the PRD so descriptions count, not just names.
      const line = prd.split('\n').find((l) => l.trim().replace(/^(?:[-*+]|\d+[.)])\s+/, '').startsWith(f.name));
      if (line && re.test(line)) f.deps.push(other.name);
    }
  }
  return out;
}

export function planTasks(project: Pick<Project, 'name' | 'files' | 'members'>, users: TestUser[]): PlannedTask[] {
  const found = featureDetails(project.files['PRD.md'] ?? '');
  const feats: Feature[] = found.length ? found : [{ name: project.name, size: 1, deps: [] }];
  const team = project.members; // teammates only (the caller filters)
  if (team.length === 0) return [];
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? id;
  const used = new Set<string>();
  // Greedy balance in PRD order: each feature goes to the least-loaded teammate so far.
  const load = new Map<string, number>(team.map((m) => [m.userId, 0]));
  const mine = new Map<string, Feature[]>(team.map((m) => [m.userId, []]));
  for (const f of feats) {
    let best = team[0];
    for (const m of team) if ((load.get(m.userId) ?? 0) < (load.get(best.userId) ?? 0)) best = m;
    mine.get(best.userId)!.push(f);
    load.set(best.userId, (load.get(best.userId) ?? 0) + f.size);
  }
  const out: PlannedTask[] = [];
  for (const m of team) {
    for (const f of mine.get(m.userId)!) {
      let folder = slugify(f.name) + '/';
      while (used.has(folder)) folder = folder.slice(0, -1) + '-2/';
      used.add(folder);
      out.push({
        title: `Build ${f.name}`,
        detail: `Build the ${f.name} feature end to end - its screens and its backend together - using the shared names in the contract.` + (f.deps.length ? ` Depends on: ${f.deps.join(', ')} - coordinate through the contract; ordering is owner-managed, not enforced.` : ''),
        assigneeId: m.userId,
        folder,
      });
    }
    if (mine.get(m.userId)!.length === 0) {
      // More members than features: give a personal folder so each folder still has exactly one owner.
      out.push({ title: 'Take a feature from the owner', detail: 'More teammates than features: the owner assigns a feature to this folder.', assigneeId: m.userId, folder: `${slugify(nameOf(m.userId))}-work/` });
    }
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

/** Simulated build output for a task. Writes only inside the task folder. Every feature
 *  gets a full-stack placeholder: a page plus its backend stub, both referencing shared names. */
export function simulateBuild(task: Task, projectName: string): Record<string, string> {
  const f = task.folder;
  return {
    [`${f}index.html`]: `<!doctype html>\n<html><body style="font-family:sans-serif;margin:0;padding:24px">\n<h1>${projectName}</h1>\n<!-- @shared PROJECT_NAME -->\n<p>Simulated page for: ${task.title}.</p>\n<button onclick="document.body.style.background='#eef'">Tap me</button>\n</body></html>\n`,
    [`${f}api.ts`]: `// @shared API_BASE\n// Simulated backend for: ${task.title}\nexport const routes = ['/health'];\n`,
  };
}
