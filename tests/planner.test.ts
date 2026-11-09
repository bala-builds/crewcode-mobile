import { describe, expect, it } from 'vitest';
import { buildPlanningPrompt, buildTaskPrompt, parsePlanJson, planWithProvider } from '../src/core/planner';
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
      { title: 'Build UI', detail: 'screens', assignee: 'u-seeta', folder: 'frontend/' },
      { title: 'Build API', detail: 'endpoints', assignee: 'u-ram', folder: 'backend/' },
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
    const mine = { title: 'Build UI', detail: 'screens and taps', assigneeId: 'u-seeta', folder: 'frontend/' };
    const theirs = { title: 'Secret backend plan', detail: 'hidden endpoints', assigneeId: 'u-ram', folder: 'backend/' };
    const text = buildTaskPrompt(p, mine).map((t) => t.content).join('\n');
    expect(text).toContain('Build UI');
    expect(text).toContain('frontend/');
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
      { title: 'Build UI', detail: 'screens', assignee: 'Seeta', folder: 'frontend/' },
      { title: 'Build API', detail: 'endpoints', assignee: 'Ram', folder: 'backend/' },
    ]);
    const res = await planWithProvider(mockProvider(named), p, users);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.plan.map((t) => t.assigneeId).sort()).toEqual(['u-ram', 'u-seeta']);
  });
});
