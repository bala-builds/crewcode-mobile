import { describe, expect, it } from 'vitest';
import { buildPlanningPrompt, buildTaskPrompt, parsePlanJson, planWithProvider } from '../src/core/planner';
import { extractFeatures, planTasks, validatePlan } from '../src/core/orchestrator';
import { mockProvider } from '../src/core/llm';
import { seedState } from '../src/core/store';

const users = [
  { id: 'u-ram', name: 'Ram' },
  { id: 'u-seeta', name: 'Seeta' },
];

function project() {
  const s = seedState();
  const p = s.projects[0];
  return p;
}

describe('Phase 6 planner', () => {
  it('planning prompt carries PRD, instructions, contract and team interests', () => {
    const p = project();
    const turns = buildPlanningPrompt(p, users);
    const text = turns.map((t) => t.content).join('\n');
    expect(text).toContain('Habit Tracker'); // PRD
    expect(text).toContain('Keep code simple'); // instructions
    expect(text).toContain('PROJECT_NAME'); // contract shared name
    expect(text).toContain('frontend'); // Seeta's interest
  });

  it('rejects malformed AI output instead of saving it', async () => {
    const p = project();
    const junk = await planWithProvider(mockProvider('sure! here you go, no json'), p, users);
    expect(junk.ok).toBe(false);
    const badJson = await planWithProvider(mockProvider('[{"title":"x"}]'), p, users);
    expect(badJson.ok).toBe(false);
  });

  it('rejects a well-formed plan that violates the rules', async () => {
    const p = project();
    // Two tasks, same folder -> validatePlan must reject.
    const dup = JSON.stringify([
      { title: 'A', detail: 'a', assignee: 'u-ram', folder: 'x/' },
      { title: 'B', detail: 'b', assignee: 'u-seeta', folder: 'x/' },
    ]);
    const res = await planWithProvider(mockProvider(dup), p, users);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('rejected');
  });

  it('accepts a valid plan with one assignee and one folder per task', async () => {
    const p = project();
    const good = JSON.stringify([
      { title: 'Build UI', detail: 'screens', assignee: 'u-seeta', folder: 'home/' },
      { title: 'Build API', detail: 'endpoints', assignee: 'u-ram', folder: 'settings/' },
    ]);
    const res = await planWithProvider(mockProvider('Sure!\n' + good + '\nDone.'), p, users);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.plan).toHaveLength(2);
      expect(new Set(res.plan.map((t) => t.folder)).size).toBe(2);
    }
  });

  it("a teammate's task prompt never contains another teammate's task", () => {
    const p = project();
    const mine = { title: 'Build UI', detail: 'screens and taps', assigneeId: 'u-seeta', folder: 'home/' };
    const theirs = { title: 'Secret backend plan', detail: 'hidden endpoints', assigneeId: 'u-ram', folder: 'settings/' };
    const text = buildTaskPrompt(p, mine).map((t) => t.content).join('\n');
    expect(text).toContain('Build UI');
    expect(text).toContain('home/');
    expect(text).toContain('PROJECT_NAME'); // contract included
    expect(text).not.toContain(theirs.title);
    expect(text).not.toContain(theirs.detail);
    expect(text).not.toContain(theirs.folder);
  });

  it('parsePlanJson rejects non-arrays and empty arrays', () => {
    const p = project();
    expect(parsePlanJson('{}', p.members).ok).toBe(false);
    expect(parsePlanJson('[]', p.members).ok).toBe(false);
    expect(parsePlanJson('[1,2]', p.members).ok).toBe(false);
  });
});

describe('assignee resolution', () => {
  it('resolves member names from AI output to user ids', async () => {
    const p = seedState().projects[0];
    const named = JSON.stringify([
      { title: 'Build UI', detail: 'screens', assignee: 'Seeta', folder: 'home/' },
      { title: 'Build API', detail: 'endpoints', assignee: 'Ram', folder: 'settings/' },
    ]);
    const res = await planWithProvider(mockProvider(named), p, users);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.plan.map((t) => t.assigneeId).sort()).toEqual(['u-ram', 'u-seeta']);
  });
});

describe('feature-based decomposition (deterministic fallback)', () => {
  const team = [
    { userId: 'u-seeta', role: 'teammate' as const, interests: [], ai: { kind: 'owner' as const } },
    { userId: 'u-hanuma', role: 'teammate' as const, interests: [], ai: { kind: 'owner' as const } },
  ];
  const users2 = [
    { id: 'u-seeta', name: 'Seeta' },
    { id: 'u-hanuma', name: 'Hanuma' },
  ];
  const proj = (prd: string) => ({ name: 'App', files: { 'PRD.md': prd }, members: team });

  it('extracts features from a PRD list, stripping descriptions', () => {
    expect(extractFeatures('# Shop\n\nFeatures:\n- Catalog: browse items\n- Cart: add and remove\n- Checkout: pay\n')).toEqual(['Catalog', 'Cart', 'Checkout']);
    expect(extractFeatures('# App\nSome prose without a list.')).toEqual([]);
  });

  it('balances features by rough size: 2 people, 4 pages, each end to end', () => {
    const plan = planTasks(proj('# App\n\n- Get started\n- Login\n- Home\n- Settings\n'), users2);
    // Greedy least-loaded in PRD order: 'Get started' (11) to Seeta; the three shorter
    // lines balance onto Hanuma. No feature is split; every folder has one owner.
    expect(plan.map((t) => [t.assigneeId, t.folder])).toEqual([
      ['u-seeta', 'get-started/'], ['u-hanuma', 'login/'], ['u-hanuma', 'home/'], ['u-hanuma', 'settings/'],
    ]);
    expect(plan[0].detail).toContain('end to end');
    expect(validatePlan(plan, team).ok).toBe(true);
  });

  it('uneven workload: one big feature stays whole, smaller ones pack onto the other person (food app)', () => {
    const prd = '# Food Now\n\nFeatures:\n- Restaurant search: browse, filter and rank restaurants with menus, photos and reviews across many screens\n- Order: cart and checkout\n- Tracking: live order status\n- Profile: account pages\n';
    const plan = planTasks(proj(prd), users2);
    const byUser = (id: string) => plan.filter((t) => t.assigneeId === id).map((t) => t.folder);
    expect(byUser('u-seeta')).toEqual(['restaurant-search/']);
    expect(byUser('u-hanuma')).toEqual(['order/', 'tracking/', 'profile/']);
    expect(validatePlan(plan, team).ok).toBe(true);
  });

  it('dependency hints become structured, validated deps (numbered CLI tool)', () => {
    const prd = '# cfg-tool\n\n1. Parse: read and validate config files\n2. Report: render the output, after Parse\n';
    const plan = planTasks(proj(prd), users2);
    const report = plan.find((t) => t.folder === 'report/')!;
    expect(report.detail).toContain('Depends on: Parse');
    expect(report.deps).toEqual(['parse/']);
    expect(validatePlan(plan, team).ok).toBe(true);
  });

  it('invalid structured deps reject the plan: unknown folder, self-dependency, cycles', () => {
    const base = [
      { title: 'A', detail: 'a', assigneeId: 'u-seeta', folder: 'a/' },
      { title: 'B', detail: 'b', assigneeId: 'u-hanuma', folder: 'b/' },
    ];
    expect(validatePlan(base.map((t, i) => i === 0 ? { ...t, deps: ['nope/'] } : t), team).ok).toBe(false);
    expect(validatePlan(base.map((t, i) => i === 0 ? { ...t, deps: ['a/'] } : t), team).ok).toBe(false);
    const cyc = [{ ...base[0], deps: ['b/'] }, { ...base[1], deps: ['a/'] }];
    expect(validatePlan(cyc, team).ok).toBe(false);
    expect(validatePlan([{ ...base[0], deps: ['b/'] }, base[1]], team).ok).toBe(true);
    expect(validatePlan(base.map((t, i) => i === 0 ? { ...t, folder: 'shared/' } : t), team).ok).toBe(false);
  });

  it('one feature per person when people match features; extra people get an owner-assigned folder', () => {
    const four = [...team,
      { userId: 'u-c', role: 'teammate' as const, interests: [], ai: { kind: 'owner' as const } },
      { userId: 'u-d', role: 'teammate' as const, interests: [], ai: { kind: 'owner' as const } },
    ];
    const users4 = [...users2, { id: 'u-c', name: 'C' }, { id: 'u-d', name: 'D' }];
    const plan = planTasks({ name: 'App', files: { 'PRD.md': '# App\n\n- Get started\n- Login\n- Home\n- Settings\n' }, members: four }, users4);
    expect(plan.map((t) => t.folder)).toEqual(['get-started/', 'login/', 'home/', 'settings/']);
    expect(new Set(plan.map((t) => t.assigneeId)).size).toBe(4);
    const six = [...four, { userId: 'u-e', role: 'teammate' as const, interests: [], ai: { kind: 'owner' as const } }];
    const plan6 = planTasks({ name: 'App', files: { 'PRD.md': '# App\n\n- Home\n- Settings\n' }, members: six }, [...users4, { id: 'u-e', name: 'E' }]);
    expect(plan6.filter((t) => t.title === 'Take a feature from the owner')).toHaveLength(3);
    expect(validatePlan(plan6, six).ok).toBe(true);
  });

  it('falls back to a single project-name feature when the PRD has no list', () => {
    const plan = planTasks(proj('# Just prose about an app.'), users2);
    expect(plan.map((t) => t.folder)).toEqual(['app/', 'hanuma-work/']);
  });

  it('never splits a feature across people: each folder has exactly one owner', () => {
    const plan = planTasks(proj('# App\n\n- Catalog\n- Cart\n- Checkout\n'), users2);
    const folders = plan.map((t) => t.folder);
    expect(new Set(folders).size).toBe(folders.length);
    expect(validatePlan(plan, team).ok).toBe(true);
  });
});
