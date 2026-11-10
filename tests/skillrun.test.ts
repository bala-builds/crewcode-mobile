import { describe, expect, it } from 'vitest';
import { seedState, assignTasks, addSkill, approveSkill, removeSkill, runSkill, saveFile } from '../src/core/store';

function setup() {
  let s = seedState();
  const p = s.projects[0];
  const r = assignTasks(s, p.id, 'u-ram');
  if (r.ok) s = r.state;
  return { s, p: s.projects[0] };
}

describe('Phase 7: two tools install, run within scope, and can be removed', () => {
  it('code-review runs inside scope and reports shared-name checks', () => {
    const { s, p } = setup();
    let st = addSkill(s, p.id, 'u-ram', 'code-review');
    if (!st.ok) throw new Error(st.error);
    // Seeta builds her frontend file first
    const w = saveFile(st.state, p.id, 'u-seeta', 'home/index.html', '<!-- @shared PROJECT_NAME -->\n<p>hi</p>\n');
    if (!w.ok) throw new Error(w.error);
    const run = runSkill(w.state, p.id, 'u-seeta', 'code-review', 'home/index.html');
    expect(run.ok).toBe(true);
    if (run.ok) {
      expect(run.output).toContain('PROJECT_NAME');
      expect(run.output).toContain('match the contract');
      const msgs = run.state.projects[0].messages;
      expect(msgs[msgs.length - 1].text).toContain('Local shared-name check');
    }
  });

  it('secret-scan scans only in-scope files and masks findings', () => {
    const { s, p } = setup();
    let st = addSkill(s, p.id, 'u-ram', 'secret-scan');
    if (!st.ok) throw new Error(st.error);
    const KEY = 'gsk_AbCdEfGhIjKlMnOpQrStUvWx';
    const w = saveFile(st.state, p.id, 'u-seeta', 'home/config.ts', `const k = '${KEY}';\n`);
    if (!w.ok) throw new Error(w.error);
    const run = runSkill(w.state, p.id, 'u-seeta', 'secret-scan', 'home/config.ts');
    expect(run.ok).toBe(true);
    if (run.ok) {
      expect(run.output).toContain('possible secret');
      expect(run.output).not.toContain(KEY); // masked
    }
  });

  it('refuses out-of-scope paths and runs nothing', () => {
    const { s, p } = setup();
    let st = addSkill(s, p.id, 'u-ram', 'code-review');
    if (!st.ok) throw new Error(st.error);
    const before = st.state.projects[0].messages.length;
    const run = runSkill(st.state, p.id, 'u-seeta', 'code-review', 'outside/server.ts');
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.error).toContain('outside your scope');
    expect(st.state.projects[0].messages.length).toBe(before); // nothing written
  });

  it('refuses before owner approval and after removal', () => {
    const { s, p } = setup();
    let st = addSkill(s, p.id, 'u-seeta', 'code-review'); // teammate adds -> pending approval
    if (!st.ok) throw new Error(st.error);
    expect(runSkill(st.state, p.id, 'u-seeta', 'code-review', 'home/index.html').ok).toBe(false);
    let ap = approveSkill(st.state, p.id, 'u-ram', 'code-review');
    if (!ap.ok) throw new Error(ap.error);
    const w = saveFile(ap.state, p.id, 'u-seeta', 'home/a.ts', 'export {};\n');
    if (!w.ok) throw new Error(w.error);
    expect(runSkill(w.state, p.id, 'u-seeta', 'code-review', 'home/a.ts').ok).toBe(true);
    const rm = removeSkill(w.state, p.id, 'u-ram', 'code-review');
    if (!rm.ok) throw new Error(rm.error);
    expect(runSkill(rm.state, p.id, 'u-seeta', 'code-review', 'home/a.ts').ok).toBe(false);
  });

  it('docs-mcp runs locally as an outline tool on an in-scope document', () => {
    const { s, p } = setup();
    let st = addSkill(s, p.id, 'u-ram', 'docs-mcp');
    if (!st.ok) throw new Error(st.error);
    const run = runSkill(st.state, p.id, 'u-ram', 'docs-mcp', 'PRD.md');
    expect(run.ok).toBe(true);
    if (run.ok) expect(run.output).toContain('Outline of PRD.md');
  });

  it('items declaring capabilities this build lacks are refused with the reason', () => {
    const { s, p } = setup();
    let st = addSkill(s, p.id, 'u-ram', 'claude-design'); // declares write_scope
    if (!st.ok) throw new Error(st.error);
    const run = runSkill(st.state, p.id, 'u-ram', 'claude-design', 'PRD.md');
    expect(run.ok).toBe(false);
    if (!run.ok) {
      expect(run.error).toContain('capabilities');
      expect(run.error).toContain('write_scope');
    }
  });

  it('a runnable-kind item still cannot read outside the member scope', () => {
    const { s, p } = setup();
    let st = addSkill(s, p.id, 'u-ram', 'docs-mcp');
    if (!st.ok) throw new Error(st.error);
    const run = runSkill(st.state, p.id, 'u-seeta', 'docs-mcp', 'settings/server.ts');
    expect(run.ok).toBe(false);
  });
});
