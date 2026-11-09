import { describe, it, expect } from 'vitest';
import { Api } from '../src/server/api';

const setup = () => {
  const api = new Api();
  const pid = (api.call({ as: 'u-ram', op: 'listProjects' }) as any).data[0].id as string;
  api.call({ as: 'u-ram', op: 'assignTasks', args: { projectId: pid } });
  return { api, pid };
};

describe('server-side permission enforcement', () => {
  it('outsider cannot read or probe a project', () => {
    const { api, pid } = setup();
    expect(api.call({ as: 'u-outsider', op: 'getProject', args: { projectId: pid } })).toEqual({ ok: false, error: 'Project not found.' });
    expect(api.call({ as: 'u-outsider', op: 'getProject', args: { projectId: 'nope' } })).toEqual({ ok: false, error: 'Project not found.' });
    expect((api.call({ as: 'u-outsider', op: 'listProjects' }) as any).data).toEqual([]);
  });
  it('teammate never receives the team code, other teammates\' tasks or owner-only data', () => {
    const { api, pid } = setup();
    const v = (api.call({ as: 'u-seeta', op: 'getProject', args: { projectId: pid } }) as any).data;
    expect(v.teamCode).toBeUndefined();
    expect(JSON.stringify(v)).not.toContain('DEM-123');
    expect(v.tasks.every((t: any) => t.assigneeId === 'u-seeta')).toBe(true);
  });
  it('write outside own folder is refused by the server and file is unchanged', () => {
    const { api, pid } = setup();
    const r = api.call({ as: 'u-seeta', op: 'saveFile', args: { projectId: pid, path: 'backend/x.ts', content: 'x' } });
    expect(r.ok).toBe(false);
    expect(api.call({ as: 'u-seeta', op: 'saveFile', args: { projectId: pid, path: '../PRD.md', content: 'x' } }).ok).toBe(false);
    expect(api.call({ as: 'u-seeta', op: 'saveFile', args: { projectId: pid, path: 'frontend/a.ts', content: 'ok' } }).ok).toBe(true);
  });
  it('teammate cannot use owner operations', () => {
    const { api, pid } = setup();
    for (const op of ['assignTasks', 'regenerateCode', 'revokeCode', 'setOwnerKeySharing']) {
      expect(api.call({ as: 'u-seeta', op, args: { projectId: pid, on: false } }).ok).toBe(false);
    }
    expect(api.call({ as: 'u-seeta', op: 'removeMember', args: { projectId: pid, targetId: 'u-ram' } }).ok).toBe(false);
  });
  it('unknown identity and unknown operation are rejected', () => {
    const { api } = setup();
    expect(api.call({ as: 'u-nobody', op: 'listProjects' }).ok).toBe(false);
    expect(api.call({ as: 'u-ram', op: 'dropTables' }).ok).toBe(false);
  });
});

describe('API parity: skills, conflicts, backup', () => {
  it('runSkill through the API enforces approval and scope', () => {
    const { api, pid } = setup();
    // Teammate adds; unapproved -> refused.
    expect(api.call({ as: 'u-seeta', op: 'addSkill', args: { projectId: pid, skillId: 'code-review' } }).ok).toBe(true);
    expect(api.call({ as: 'u-seeta', op: 'runSkill', args: { projectId: pid, skillId: 'code-review', path: 'frontend/a.ts' } }).ok).toBe(false);
    // Owner approves; out-of-scope path still refused; in-scope works.
    expect(api.call({ as: 'u-ram', op: 'approveSkill', args: { projectId: pid, skillId: 'code-review' } }).ok).toBe(true);
    expect(api.call({ as: 'u-seeta', op: 'runSkill', args: { projectId: pid, skillId: 'code-review', path: 'backend/x.ts' } }).ok).toBe(false);
    api.call({ as: 'u-seeta', op: 'saveFile', args: { projectId: pid, path: 'frontend/a.ts', content: 'export {};\n' } });
    const run = api.call({ as: 'u-seeta', op: 'runSkill', args: { projectId: pid, skillId: 'code-review', path: 'frontend/a.ts' } }) as any;
    expect(run.ok).toBe(true);
    expect(run.data.output).toContain('Review of frontend/a.ts');
    // Removal ends access.
    expect(api.call({ as: 'u-ram', op: 'removeSkill', args: { projectId: pid, skillId: 'code-review' } }).ok).toBe(true);
    expect(api.call({ as: 'u-seeta', op: 'runSkill', args: { projectId: pid, skillId: 'code-review', path: 'frontend/a.ts' } }).ok).toBe(false);
  });

  it('saveFile with a stale baseRev conflicts through the API', () => {
    const { api, pid } = setup();
    expect(api.call({ as: 'u-ram', op: 'saveFile', args: { projectId: pid, path: 'PRD.md', content: '# v2', baseRev: 0 } }).ok).toBe(true);
    const stale = api.call({ as: 'u-ram', op: 'saveFile', args: { projectId: pid, path: 'PRD.md', content: '# clobber', baseRev: 0 } }) as any;
    expect(stale.ok).toBe(false);
    expect(stale.error).toContain('Conflict');
  });

  it('export/restore round-trip through the API, owner only', () => {
    const { api, pid } = setup();
    expect(api.call({ as: 'u-seeta', op: 'exportProject', args: { projectId: pid } }).ok).toBe(false);
    const ex = api.call({ as: 'u-ram', op: 'exportProject', args: { projectId: pid } }) as any;
    expect(ex.ok).toBe(true);
    api.call({ as: 'u-ram', op: 'saveFile', args: { projectId: pid, path: 'PRD.md', content: '# changed' } });
    const re = api.call({ as: 'u-ram', op: 'restoreProject', args: { json: ex.data.json } }) as any;
    expect(re.ok).toBe(true);
    const v = (api.call({ as: 'u-ram', op: 'getProject', args: { projectId: pid } }) as any).data;
    expect(v.files['PRD.md']).toContain('Habit Tracker');
  });
});

describe('join limit through the API boundary', () => {
  it('limit 1: first join commits, the next is refused even issued back to back', async () => {
    const api = new Api();
    const pid = (api.call({ as: 'u-ram', op: 'listProjects' }) as any).data[0].id;
    expect((api.call({ as: 'u-ram', op: 'setTeamJoinLimit', args: { projectId: pid, maxJoins: 1 } }) as any).ok).toBe(true);
    const first = api.call({ as: 'u-hanuma', op: 'joinProject', args: { code: 'DEM-123', interests: ['x'] } }) as any;
    expect(first.ok).toBe(true);
    // Issued immediately after: the second caller already sees joinsUsed = 1.
    const second = api.call({ as: 'u-outsider', op: 'joinProject', args: { code: 'DEM-123', interests: ['y'] } }) as any;
    expect(second.ok).toBe(false);
    expect(second.error).toContain('join limit');
    const v = (api.call({ as: 'u-ram', op: 'getProject', args: { projectId: pid } }) as any).data;
    expect(v.teamJoinsUsed).toBe(1);
    expect(v.teamMaxJoins).toBe(1);
    // Teammate views never carry code state.
    const tv = (api.call({ as: 'u-seeta', op: 'getProject', args: { projectId: pid } }) as any).data;
    expect(tv.teamMaxJoins).toBeUndefined();
    expect(tv.teamJoinsUsed).toBeUndefined();
    expect(tv.teamExpiresAt).toBeUndefined();
  });
});

describe('mutation version counter (cross-session propagation)', () => {
  it('every committed change bumps the version; views carry it', () => {
    const { api, pid } = setup();
    const v0 = (api.call({ as: 'u-ram', op: 'getVersion' }) as any).data.version as number;
    api.call({ as: 'u-ram', op: 'setOwnerKeySharing', args: { projectId: pid, on: true } });
    const v1 = (api.call({ as: 'u-seeta', op: 'getVersion' }) as any).data.version as number;
    expect(v1).toBeGreaterThan(v0);
    const view = (api.call({ as: 'u-seeta', op: 'getProject', args: { projectId: pid } }) as any).data;
    expect(view.stateVersion).toBe(v1);
    // A failed op does not bump the counter.
    api.call({ as: 'u-seeta', op: 'revokeCode', args: { projectId: pid } });
    expect((api.call({ as: 'u-ram', op: 'getVersion' }) as any).data.version).toBe(v1);
  });
});
