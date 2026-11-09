import { describe, it, expect } from 'vitest';
import { Api } from '../src/server/api';

// Owner-to-teammate flow through the server-side API. Real: team code, joining, folder rules, redaction, saves.
// Simulated (not counted as working AI): task planning and builds. No provider, no auth.
describe('owner to teammate working flow (test identities, simulated AI)', () => {
  it('create -> invite -> join -> assign -> build -> edit -> refusal -> revoke', () => {
    const api = new Api(); const call = (as: string, op: string, args: any = {}) => api.call({ as, op, args });
    const c: any = call('u-ram', 'createProject', { name: 'Shop App', prd: '# Shop\nA shop.', instructions: 'Keep it simple.' });
    expect(c.ok).toBe(true); const pid = c.data.projectId;
    const code = (call('u-ram', 'getProject', { projectId: pid }) as any).data.teamCode;
    expect(code).toMatch(/\S/);
    // outsider with a wrong code fails; teammate joins with the right one
    expect(call('u-hanuma', 'joinProject', { code: 'WRONG-000', interests: ['backend'] }).ok).toBe(false);
    expect(call('u-hanuma', 'joinProject', { code, interests: ['backend'] }).ok).toBe(true);
    expect(call('u-seeta', 'joinProject', { code, interests: ['frontend'] }).ok).toBe(true);
    // owner AI splits work; teammates only
    expect(call('u-ram', 'assignTasks', { projectId: pid }).ok).toBe(true);
    const sv: any = (call('u-seeta', 'getProject', { projectId: pid }) as any).data;
    const hv: any = (call('u-hanuma', 'getProject', { projectId: pid }) as any).data;
    expect(sv.tasks).toHaveLength(1); expect(hv.tasks).toHaveLength(1);
    expect(sv.tasks[0].folder).not.toBe(hv.tasks[0].folder);
    // each builds in own folder, edits, and cannot touch the other's folder
    expect(call('u-seeta', 'setAiAccess', { projectId: pid, access: { kind: 'owner' } }).ok).toBe(true);
    expect(call('u-seeta', 'runBuild', { projectId: pid, taskId: sv.tasks[0].id }).ok).toBe(true);
    const sf = sv.tasks[0].folder as string;
    expect(call('u-seeta', 'saveFile', { projectId: pid, path: sf + 'notes.md', content: 'mine' }).ok).toBe(true);
    expect(call('u-seeta', 'saveFile', { projectId: pid, path: hv.tasks[0].folder + 'x.ts', content: 'no' }).ok).toBe(false);
    // teammate never sees the other's files in their view
    const sv2: any = (call('u-seeta', 'getProject', { projectId: pid }) as any).data;
    expect(Object.keys(sv2.files).some((f) => f.startsWith(hv.tasks[0].folder))).toBe(false);
    // owner sees everything, then revokes the code; a new joiner is refused
    const ov: any = (call('u-ram', 'getProject', { projectId: pid }) as any).data;
    expect(Object.keys(ov.files)).toContain(sf + 'notes.md');
    expect(call('u-ram', 'revokeCode', { projectId: pid }).ok).toBe(true);
    expect(call('u-outsider', 'joinProject', { code, interests: [] }).ok).toBe(false);
    // removed member loses access
    expect(call('u-ram', 'removeMember', { projectId: pid, targetId: 'u-hanuma' }).ok).toBe(true);
    expect(call('u-hanuma', 'getProject', { projectId: pid }).ok).toBe(false);
  });
});
