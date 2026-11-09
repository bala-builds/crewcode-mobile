import { describe, expect, it } from 'vitest';
import { exportProject, restoreProject } from '../src/core/backup';
import { seedState, saveFile, fileRev } from '../src/core/store';

describe('Phase 8: backup and restore', () => {
  it('restore brings files back after later edits', () => {
    let s = seedState();
    const p = s.projects[0];
    const ex = exportProject(s, p.id, 'u-ram');
    expect(ex.ok).toBe(true);
    if (!ex.ok) return;
    const w = saveFile(s, p.id, 'u-ram', 'PRD.md', '# changed after backup');
    if (!w.ok) throw new Error(w.error);
    const re = restoreProject(w.state, 'u-ram', ex.json);
    expect(re.ok).toBe(true);
    if (re.ok) {
      expect(re.state.projects[0].files['PRD.md']).toContain('Habit Tracker');
    }
  });

  it('restore bumps revisions so stale editors conflict, not clobber', () => {
    let s = seedState();
    const p = s.projects[0];
    const ex = exportProject(s, p.id, 'u-ram');
    if (!ex.ok) throw new Error('export failed');
    const revBefore = fileRev(s, p.id, 'PRD.md');
    const re = restoreProject(s, 'u-ram', ex.json);
    if (!re.ok) throw new Error('restore failed');
    const revAfter = fileRev(re.state, p.id, 'PRD.md');
    expect(revAfter).toBeGreaterThan(revBefore);
    // An editor still holding the pre-restore revision is refused.
    const stale = saveFile(re.state, p.id, 'u-ram', 'PRD.md', '# stale edit', revBefore);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error).toContain('Conflict');
  });

  it('rejects malformed and foreign files', () => {
    const s = seedState();
    expect(restoreProject(s, 'u-ram', 'not json').ok).toBe(false);
    expect(restoreProject(s, 'u-ram', '{"format":"other"}').ok).toBe(false);
    expect(restoreProject(s, 'u-ram', '{"format":"crewcode-backup","version":1,"project":{"id":"x"}}').ok).toBe(false);
  });

  it('teammates can neither export nor restore', () => {
    const s = seedState();
    const p = s.projects[0];
    expect(exportProject(s, p.id, 'u-seeta').ok).toBe(false);
    const ex = exportProject(s, p.id, 'u-ram');
    if (!ex.ok) throw new Error('export failed');
    expect(restoreProject(s, 'u-seeta', ex.json).ok).toBe(false);
  });

  it('refuses to restore a project that does not exist here', () => {
    const s = seedState();
    const p = s.projects[0];
    const ex = exportProject(s, p.id, 'u-ram');
    if (!ex.ok) throw new Error('export failed');
    const other = JSON.parse(ex.json);
    other.project.id = 'p-does-not-exist';
    expect(restoreProject(s, 'u-ram', JSON.stringify(other)).ok).toBe(false);
  });
});
