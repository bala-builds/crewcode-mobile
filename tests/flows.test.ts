import { describe, it, expect } from 'vitest';
import { teamState, ok } from './helpers';
import { seedState, createProject, joinProject, revokeCode, regenerateCode, setTeamCodeExpiry, setTeamJoinLimit, setAiAccess, setOwnerKeySharing, removeMember, assignTasks, runBuild, save, load, registerName, addSkill, approveSkill, removeSkill } from '../src/core/store';
import { generateTeamCode } from '../src/core/teamcode';
import { planTasks, validatePlan } from '../src/core/orchestrator';
import { integrationCheck, parseSharedNames } from '../src/core/contract';
import { keyring, maskKey } from '../src/core/providers';

describe('create and join', () => {
  it('create saves the master prompt and instructions as root files', () => {
    const r = ok(createProject(seedState(), 'u-ram', 'Notes', '# Notes app\nA notes app.', 'Be brief.'));
    const p = r.state.projects.find((x) => x.id === r.projectId)!;
    expect(p.files['PRD.md']).toContain('A notes app');
    expect(p.files['AGENT_INSTRUCTIONS.md']).toContain('Be brief');
    expect(p.files['CONTRACT.md']).toContain('## Shared names');
  });
  it('validates create input', () => {
    expect(createProject(seedState(), 'u-ram', '', 'long enough prd text', '').ok).toBe(false);
    expect(createProject(seedState(), 'u-ram', 'X', 'short', '').ok).toBe(false);
  });
  it('team code format and join errors', () => {
    expect(generateTeamCode()).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
    const s = seedState();
    expect(joinProject(s, 'u-hanuma', 'ZZZ-999', ['x']).ok).toBe(false);
    expect(joinProject(s, 'u-hanuma', 'dem123', ['frontend']).ok).toBe(true); // lowercase, no dash accepted
    expect(joinProject(s, 'u-hanuma', 'DEM-123', []).ok).toBe(false);
    expect(joinProject(s, 'u-seeta', 'DEM-123', ['x']).ok).toBe(false); // already a member
  });
  it('revoked code refuses new joins; regenerate issues a new one', () => {
    const s = seedState(); const pid = s.projects[0].id;
    const r = ok(revokeCode(s, pid, 'u-ram'));
    const j = joinProject(r.state, 'u-hanuma', 'DEM-123', ['x']);
    expect(j.ok).toBe(false);
    const g = ok(regenerateCode(r.state, pid, 'u-ram'));
    expect(g.state.projects[0].team.revoked).toBe(false);
    expect(g.state.projects[0].team.code).not.toBe('DEM-123');
    expect(revokeCode(s, pid, 'u-seeta').ok).toBe(false);
  });
  it('team codes expire: expired codes refuse joins, regenerating reopens with a fresh window', () => {
    const s = seedState(); const p = s.projects[0];
    // New codes come with a live expiry window (PRD B5).
    expect(p.team.expiresAt).not.toBeNull();
    expect(p.team.expiresAt!).toBeGreaterThan(Date.now());
    p.team.expiresAt = Date.now() - 1000; // force expiry
    const j = joinProject(s, 'u-hanuma', 'DEM-123', ['x']);
    expect(j.ok).toBe(false);
    if (j.ok) throw Error();
    expect(j.error).toContain('expired');
    const g = ok(regenerateCode(s, p.id, 'u-ram'));
    expect(g.state.projects[0].team.code).not.toBe('DEM-123');
    expect(g.state.projects[0].team.expiresAt!).toBeGreaterThan(Date.now());
    expect(joinProject(g.state, 'u-hanuma', g.state.projects[0].team.code, ['x']).ok).toBe(true);
  });
  it('owner configures code expiry: clearing expiry reopens an expired code', () => {
    const s = seedState(); const p = s.projects[0];
    p.team.expiresAt = Date.now() - 1000; // force expiry
    expect(joinProject(s, 'u-hanuma', 'DEM-123', ['x']).ok).toBe(false);
    expect(setTeamCodeExpiry(s, p.id, 'u-seeta', null).ok).toBe(false); // teammate cannot
    const cleared = ok(setTeamCodeExpiry(s, p.id, 'u-ram', null));
    expect(cleared.state.projects[0].team.expiresAt).toBeNull();
    expect(joinProject(cleared.state, 'u-hanuma', 'DEM-123', ['x']).ok).toBe(true); // code itself unchanged
    const extended = ok(setTeamCodeExpiry(s, p.id, 'u-ram', 1));
    expect(extended.state.projects[0].team.expiresAt!).toBeGreaterThan(Date.now());
    expect(setTeamCodeExpiry(s, p.id, 'u-ram', 0).ok).toBe(false);
    expect(setTeamCodeExpiry(s, p.id, 'u-ram', 400).ok).toBe(false);
  });
  it('owner join limit: boundary refusal, member rejoin keeps its message, limit removal reopens', () => {
    let s = seedState(); const pid = s.projects[0].id;
    expect(setTeamJoinLimit(s, pid, 'u-seeta', 1).ok).toBe(false); // teammate cannot
    expect(setTeamJoinLimit(s, pid, 'u-ram', 0).ok).toBe(false);
    expect(setTeamJoinLimit(s, pid, 'u-ram', 1.5).ok).toBe(false);
    s = ok(setTeamJoinLimit(s, pid, 'u-ram', 1)).state;
    // Seeta is already a member and does not count; the limit counts joins, not members.
    s = ok(joinProject(s, 'u-hanuma', 'DEM-123', ['x'])).state; // uses the one join
    expect(s.projects[0].team.joinsUsed).toBe(1);
    const j2 = joinProject(s, 'u-outsider', 'DEM-123', ['y']);
    expect(j2.ok).toBe(false);
    if (j2.ok) throw Error();
    expect(j2.error).toContain('join limit');
    // An existing member who tries again still gets already-member, not the limit message.
    const j3 = joinProject(s, 'u-hanuma', 'DEM-123', ['z']);
    expect(j3.ok).toBe(false);
    if (j3.ok) throw Error();
    expect(j3.error).toContain('already');
    // Concurrent-looking attempt from stale state is not a path the server serves: each API
    // call commits before the next reads, so the boundary holds strictly (api-level check below).
    s = ok(setTeamJoinLimit(s, pid, 'u-ram', null)).state;
    expect(joinProject(s, 'u-outsider', 'DEM-123', ['y']).ok).toBe(true);
  });
  it('registers a name with validation', () => {
    expect(registerName(seedState(), 'A').ok).toBe(false);
    const r = ok(registerName(seedState(), '  Asha  '));
    expect(r.state.users.find((u) => u.id === r.userId)!.name).toBe('Asha');
  });
});

describe('ai access and owner key', () => {
  it('teammate cannot use the owner model after sharing is turned off', () => {
    const { state, pid } = teamState();
    const off = ok(setOwnerKeySharing(state, pid, 'u-ram', false));
    const m = off.state.projects[0].members.find((x) => x.userId === 'u-hanuma')!;
    expect(m.ai).toBeUndefined();
    expect(setAiAccess(off.state, pid, 'u-hanuma', { kind: 'owner' }).ok).toBe(false);
    expect(setAiAccess(off.state, pid, 'u-hanuma', { kind: 'own', provider: 'Claude' }).ok).toBe(true);
    expect(setOwnerKeySharing(state, pid, 'u-seeta', false).ok).toBe(false);
  });
  it('no key ever appears in state or storage', () => {
    const { state, pid } = teamState();
    keyring.set('u-hanuma', 'Gemini', 'sk-test-SECRET1234');
    const s2 = ok(setAiAccess(state, pid, 'u-hanuma', { kind: 'own', provider: 'Gemini' })).state;
    let stored = '';
    save(s2, { setItem: (_k, v) => { stored = v; } });
    expect(stored).not.toContain('SECRET1234');
    expect(JSON.stringify(s2)).not.toContain('SECRET1234');
    expect(maskKey('sk-test-SECRET1234')).toBe('••••1234');
    keyring.clear();
  });
  it('load falls back to seed on bad storage', () => {
    expect(load({ getItem: () => '{bad json' }).projects.length).toBe(1);
    expect(load({ getItem: () => null }).users.length).toBeGreaterThan(0);
  });
});

describe('ai orchestration (simulated)', () => {
  it('assigns by interest and updates contract folder ownership', () => {
    const { state } = teamState();
    const p = state.projects[0];
    expect(p.tasks.map((t) => t.folder).sort()).toEqual(['backend/', 'frontend/']);
    expect(p.files['CONTRACT.md']).toContain('frontend/ : Seeta');
    expect(p.files['CONTRACT.md']).toContain('backend/ : Hanuma');
  });
  it('plan with no teammates is valid and empty', () => {
    const s = seedState(); const pid = s.projects[0].id;
    const solo = ok(createProject(s, 'u-ram', 'Solo', 'a solo project here', '')) ;
    const r = ok(assignTasks(solo.state, solo.projectId, 'u-ram'));
    expect(r.count).toBe(0); void pid;
  });
  it('rejects overlapping folders, missing members and bad folders', () => {
    const { state } = teamState(); const p = state.projects[0];
    const team = p.members.filter((m) => m.role === 'teammate');
    const good = planTasks({ name: p.name, files: p.files, members: team }, state.users);
    expect(validatePlan(good, team).ok).toBe(true);
    expect(validatePlan([good[0], { ...good[1], folder: good[0].folder }], team).ok).toBe(false);
    expect(validatePlan([good[0]], team).ok).toBe(false);
    expect(validatePlan([{ ...good[0], folder: '../x/' }, good[1]], team).ok).toBe(false);
    expect(validatePlan([{ ...good[0], assigneeId: 'ghost' }, good[1]], team).ok).toBe(false);
  });
  it('more teammates than areas still gives one folder each', () => {
    let s = seedState(); const pid = s.projects[0].id;
    for (const [i, id] of ['u-hanuma', 'u-outsider'].entries()) s = ok(joinProject(s, id, 'DEM-123', ['x' + i])).state;
    s = ok(registerName(s, 'Extra')).state; s = ok(joinProject(s, s.currentUserId!, 'DEM-123', ['y'])).state;
    s = ok(registerName(s, 'Extra2')).state; s = ok(joinProject(s, s.currentUserId!, 'DEM-123', ['z'])).state;
    const r = ok(assignTasks(s, pid, 'u-ram'));
    const folders = r.state.projects[0].tasks.map((t) => t.folder);
    expect(new Set(folders).size).toBe(folders.length);
    expect(folders.length).toBe(r.state.projects[0].members.length - 1);
  });
  it('simulated build writes only inside the task folder and needs an AI choice', () => {
    const { state, pid } = teamState(); const p = state.projects[0];
    const t = p.tasks.find((x) => x.assigneeId === 'u-seeta')!;
    const b = ok(runBuild(state, pid, 'u-seeta', t.id));
    const files = Object.keys(b.state.projects[0].files).filter((f) => f.startsWith('frontend/'));
    expect(files.length).toBeGreaterThan(0);
    expect(Object.keys(b.state.projects[0].files).filter((f) => f.startsWith('backend/'))).toEqual([]);
    const noAi = ok(removeMember(state, pid, 'u-ram', 'u-outsider'));
    void noAi;
    const err = ok(runBuild(ok(setOwnerKeySharing(state, pid, 'u-ram', false)).state, pid, 'u-seeta', t.id));
    expect(err.state.projects[0].messages.at(-1)!.kind).toBe('ai_error');
  });
  it('simulated error leaves files unchanged', () => {
    const { state, pid } = teamState(); const t = state.projects[0].tasks[0];
    const e = ok(runBuild(state, pid, t.assigneeId, t.id, { forceError: true }));
    expect(e.state.projects[0].files).toEqual(state.projects[0].files);
    expect(e.state.projects[0].messages.at(-1)!.kind).toBe('ai_error');
  });
  it('removing a member removes their tasks', () => {
    const { state, pid } = teamState();
    const r = ok(removeMember(state, pid, 'u-ram', 'u-seeta'));
    expect(r.state.projects[0].tasks.some((t) => t.assigneeId === 'u-seeta')).toBe(false);
    expect(removeMember(state, pid, 'u-ram', 'u-ram').ok).toBe(false);
    expect(removeMember(state, pid, 'u-seeta', 'u-hanuma').ok).toBe(false);
  });
});

describe('shared contract and integration check', () => {
  it('parses shared names and flags unlisted marks', () => {
    const { state } = teamState(); const p = state.projects[0];
    expect(parseSharedNames(p.files['CONTRACT.md'])).toEqual(['PROJECT_NAME', 'API_BASE', 'THEME_COLOR']);
    const files = { ...p.files, 'frontend/a.ts': '// @shared API_BASE\n// @shared SECRET_THING\n' };
    const f = integrationCheck(p.files['CONTRACT.md'], files, 'frontend/');
    expect(f).toEqual([{ path: 'frontend/a.ts', name: 'SECRET_THING', problem: 'unlisted_shared_name' }]);
    expect(integrationCheck(p.files['CONTRACT.md'], files, 'backend/')).toEqual([]);
  });
});

describe('skills and MCP', () => {
  it('teammate additions need owner approval; owner additions are approved', () => {
    const { state, pid } = teamState();
    const a = ok(addSkill(state, pid, 'u-seeta', 'code-review'));
    expect(a.state.projects[0].skills[0].approvedByOwner).toBe(false);
    expect(approveSkill(a.state, pid, 'u-seeta', 'code-review').ok).toBe(false);
    const b = ok(approveSkill(a.state, pid, 'u-ram', 'code-review'));
    expect(b.state.projects[0].skills[0].approvedByOwner).toBe(true);
    expect(addSkill(b.state, pid, 'u-ram', 'code-review').ok).toBe(false);
    expect(addSkill(state, pid, 'u-seeta', 'nope').ok).toBe(false);
    expect(removeSkill(b.state, pid, 'u-hanuma', 'code-review').ok).toBe(false);
    expect(removeSkill(b.state, pid, 'u-ram', 'code-review').ok).toBe(true);
  });
});
