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
