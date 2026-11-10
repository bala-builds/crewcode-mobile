import { describe, it, expect } from 'vitest';
import { teamState, ok } from './helpers';
import { canAccess, visibleTasks, visibleFiles, visibleMessages, normalizePath } from '../src/core/permissions';
import { saveFile, postPrompt, runBuild } from '../src/core/store';

describe('access rules with dummy identities', () => {
  const { state, pid } = teamState();
  const p = state.projects[0];
  const seetaTask = p.tasks.find((t) => t.assigneeId === 'u-seeta')!;
  const hanumaTask = p.tasks.find((t) => t.assigneeId === 'u-hanuma')!;

  it('gives each teammate exactly one task and one folder', () => {
    expect(seetaTask.folder).toBe('home/');
    expect(hanumaTask.folder).toBe('settings/');
    expect(new Set(p.tasks.map((t) => t.folder)).size).toBe(p.tasks.length);
  });
  it('teammate sees only their tasks', () => {
    expect(visibleTasks(p, 'u-seeta').map((t) => t.id)).toEqual([seetaTask.id]);
    expect(visibleTasks(p, 'u-hanuma').map((t) => t.id)).toEqual([hanumaTask.id]);
    expect(visibleTasks(p, 'u-ram').length).toBe(p.tasks.length);
  });
  it('outsider gets nothing', () => {
    expect(visibleTasks(p, 'u-outsider')).toEqual([]);
    expect(visibleFiles(p, 'u-outsider')).toEqual([]);
    expect(visibleMessages(p, 'u-outsider')).toEqual([]);
    expect(canAccess(p, 'u-outsider', 'read', 'PRD.md')).toBe(false);
  });
  it('teammate can write only in own folder', () => {
    expect(canAccess(p, 'u-seeta', 'write', 'home/app.ts')).toBe(true);
    expect(canAccess(p, 'u-seeta', 'write', 'settings/server.ts')).toBe(false);
    expect(canAccess(p, 'u-seeta', 'read', 'settings/server.ts')).toBe(false);
  });
  it('teammate reads root documents but cannot write them', () => {
    for (const f of ['PRD.md', 'AGENT_INSTRUCTIONS.md', 'CONTRACT.md']) {
      expect(canAccess(p, 'u-seeta', 'read', f)).toBe(true);
      expect(canAccess(p, 'u-seeta', 'write', f)).toBe(false);
    }
  });
  it('rejects path tricks', () => {
    for (const bad of ['home/../settings/x.ts', '../etc/passwd', '/home/a.ts', 'frontend\\..\\a', './home/a.ts', '']) {
      expect(normalizePath(bad)).toBeNull();
      expect(canAccess(p, 'u-seeta', 'write', bad)).toBe(false);
    }
    expect(canAccess(p, 'u-seeta', 'write', 'home2/a.ts')).toBe(false); // sibling folder with the same prefix
  });
  it('saveFile refuses edits outside folder and leaves state untouched', () => {
    const r = saveFile(state, pid, 'u-seeta', 'settings/server.ts', 'x');
    expect(r.ok).toBe(false);
    const good = ok(saveFile(state, pid, 'u-seeta', 'home/index.html', '<p>hi</p>'));
    expect(good.state.projects[0].files['home/index.html']).toBe('<p>hi</p>');
    expect(state.projects[0].files['home/index.html']).toBeUndefined();
  });
  it('saveFile creates a new file inside the assignee folder; outside paths refused; blind re-create conflicts', () => {
    const created = ok(saveFile(state, pid, 'u-seeta', 'home/styles.css', 'body{}'));
    const pv = created.state.projects[0];
    expect(pv.files['home/styles.css']).toBe('body{}');
    expect(pv.fileRevs['home/styles.css']).toBe(1);
    expect(state.projects[0].files['home/styles.css']).toBeUndefined(); // original state untouched
    // outside the folder, root files, and path tricks are still refused for creation
    expect(saveFile(state, pid, 'u-seeta', 'settings/new.ts', 'x').ok).toBe(false);
    expect(saveFile(state, pid, 'u-seeta', 'PRD.md', 'x').ok).toBe(false);
    expect(saveFile(state, pid, 'u-seeta', 'home/../settings/x.ts', 'x').ok).toBe(false);
    // baseRev 0 as "must not exist": once the file exists, a blind create conflicts instead of overwriting
    expect(saveFile(created.state, pid, 'u-seeta', 'home/styles.css', 'other', 0).ok).toBe(false);
    expect(created.state.projects[0].files['home/styles.css']).toBe('body{}');
    // the owner can create anywhere, including a folder with no files yet
    const ownerMade = ok(saveFile(state, pid, 'u-ram', 'docs/notes.md', 'hi'));
    expect(ownerMade.state.projects[0].files['docs/notes.md']).toBe('hi');
  });
  it('teammate cannot prompt in or build another teammate\'s task', () => {
    expect(postPrompt(state, pid, 'u-seeta', 'hello', hanumaTask.id).ok).toBe(false);
    expect(runBuild(state, pid, 'u-seeta', hanumaTask.id).ok).toBe(false);
  });
  it('teammate does not see messages from other tasks', () => {
    let s = ok(postPrompt(state, pid, 'u-hanuma', 'secret backend note', hanumaTask.id)).state;
    const msgs = visibleMessages(s.projects[0], 'u-seeta').map((m) => m.text).join('|');
    expect(msgs).not.toContain('secret backend note');
    expect(visibleMessages(s.projects[0], 'u-ram').some((m) => m.text === 'secret backend note')).toBe(true);
  });
});
