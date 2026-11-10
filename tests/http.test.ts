// Real HTTP integration: boots the actual dev server binary (dist-server/index.js)
// on a throwaway port with a throwaway data file, then runs a full local
// owner/teammate session over fetch. No UI yet; this proves the local API path.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';

const PORT = 8975;
const URL_ = `http://127.0.0.1:${PORT}/api`;
let server: ChildProcess;
const dataFile = `/tmp/crewcode-http-test-${process.pid}.json`;

async function call(as: string, op: string, args: any = {}): Promise<any> {
  const res = await fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ as, op, args }) });
  return res.json();
}

beforeAll(async () => {
  if (!fs.existsSync('dist-server/index.js')) execSync('npm run server:build', { stdio: 'ignore' });
  server = spawn('node', ['dist-server/index.js'], { env: { ...process.env, PORT: String(PORT), CREWCODE_DATA: dataFile }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { await call('u-ram', 'listProjects'); return; } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  throw new Error('server did not start');
}, 30_000);

afterAll(() => { server?.kill(); try { fs.unlinkSync(dataFile); } catch {} });

describe('local HTTP API: full owner/teammate session', () => {
  it('create, join, assign, scoped views, save with conflict, skills, backup over HTTP', async () => {
    const c = await call('u-ram', 'createProject', { name: 'HTTP App', prd: '# HTTP App\nA real local session.\n\nFeatures:\n- Home: main screen\n- Settings: preferences\n', instructions: 'Keep it simple.' });
    expect(c.ok).toBe(true);
    const pid = c.data.projectId;
    const code = (await call('u-ram', 'getProject', { projectId: pid })).data.teamCode;
    expect(code).toMatch(/\S/);

    expect((await call('u-hanuma', 'joinProject', { code: 'NOPE-000', interests: ['backend'] })).ok).toBe(false);
    expect((await call('u-hanuma', 'joinProject', { code, interests: ['backend'] })).ok).toBe(true);
    expect((await call('u-seeta', 'joinProject', { code, interests: ['frontend'] })).ok).toBe(true);
    expect((await call('u-ram', 'assignTasks', { projectId: pid })).ok).toBe(true);
    // The async assign path proposes only; the owner approves before tasks exist.
    expect((await call('u-ram', 'getProject', { projectId: pid })).data.tasks).toHaveLength(0);
    expect((await call('u-ram', 'confirmPlanning', { projectId: pid, accept: true })).ok).toBe(true);

    // Teammate view is redacted: no team code, only own tasks.
    const sv = (await call('u-seeta', 'getProject', { projectId: pid })).data;
    expect(sv.teamCode).toBeUndefined();
    expect(sv.tasks.every((t: any) => t.assigneeId === 'u-seeta')).toBe(true);

    // Scoped save + revision conflict over HTTP.
    expect((await call('u-seeta', 'saveFile', { projectId: pid, path: 'settings/a.ts', content: 'export {};\n' })).ok).toBe(true);
    expect((await call('u-seeta', 'saveFile', { projectId: pid, path: 'home/x.ts', content: 'x' })).ok).toBe(false);
    expect((await call('u-ram', 'saveFile', { projectId: pid, path: 'PRD.md', content: '# v2', baseRev: 0 })).ok).toBe(true);
    const stale = await call('u-ram', 'saveFile', { projectId: pid, path: 'PRD.md', content: '# clobber', baseRev: 0 });
    expect(stale.ok).toBe(false);
    expect(stale.error).toContain('Conflict');

    // Skill lifecycle over HTTP: add (teammate) -> blocked -> approve -> run in scope -> remove -> blocked.
    expect((await call('u-seeta', 'addSkill', { projectId: pid, skillId: 'code-review' })).ok).toBe(true);
    expect((await call('u-seeta', 'runSkill', { projectId: pid, skillId: 'code-review', path: 'settings/a.ts' })).ok).toBe(false);
    expect((await call('u-ram', 'approveSkill', { projectId: pid, skillId: 'code-review' })).ok).toBe(true);
    expect((await call('u-seeta', 'runSkill', { projectId: pid, skillId: 'code-review', path: 'home/x.ts' })).ok).toBe(false);
    const run = await call('u-seeta', 'runSkill', { projectId: pid, skillId: 'code-review', path: 'settings/a.ts' });
    expect(run.ok).toBe(true);
    expect(run.data.output).toContain('Review of settings/a.ts');
    expect((await call('u-ram', 'removeSkill', { projectId: pid, skillId: 'code-review' })).ok).toBe(true);
    expect((await call('u-seeta', 'runSkill', { projectId: pid, skillId: 'code-review', path: 'settings/a.ts' })).ok).toBe(false);

    // Backup/restore over HTTP, owner only.
    expect((await call('u-seeta', 'exportProject', { projectId: pid })).ok).toBe(false);
    const ex = await call('u-ram', 'exportProject', { projectId: pid });
    expect(ex.ok).toBe(true);
    await call('u-ram', 'saveFile', { projectId: pid, path: 'PRD.md', content: '# changed' });
    expect((await call('u-ram', 'restoreProject', { json: ex.data.json })).ok).toBe(true);
    expect((await call('u-ram', 'getProject', { projectId: pid })).data.files['PRD.md']).toBe('# v2'); // backup was exported after the v2 save

    // State persisted to the data file across calls.
    expect(fs.existsSync(dataFile)).toBe(true);
  }, 30_000);
});
