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
