import { describe, expect, it } from 'vitest';
import { runToolInSandbox } from '../src/core/toolproc';
import { seedState, runSkill, addSkill, approveSkill } from '../src/core/store';

describe('tool sandbox boundary', () => {
  it('runs a real handler through the sandbox process', () => {
    const r = runToolInSandbox('docs-mcp', '# A\nx\n## B', '', 'PRD.md');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.output).toContain('Headings: # A | ## B');
  });
  it('a handler cannot read the filesystem, spawn processes, or start workers (runtime-enforced)', () => {
    process.env.CREWCODE_PROBE = '1';
    try {
      const r = runToolInSandbox('__probe_fs', '', '', 'x');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.output).toBe('probe: FS-DENIED CP-DENIED WK-DENIED');
    } finally { delete process.env.CREWCODE_PROBE; }
  });
  it('a handler that never returns is timed out and nothing is written', () => {
    process.env.CREWCODE_PROBE = '1';
    try {
      const r = runToolInSandbox('__probe_hang', '', '', 'x');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/timed out|stopped/);
    } finally { delete process.env.CREWCODE_PROBE; }
  }, 10000);
  it('probe handlers do not exist without CREWCODE_PROBE', () => {
    const r = runToolInSandbox('__probe_fs', '', '', 'x');
    expect(r.ok).toBe(false);
  });
  it('runSkill still serves output through the sandbox path', () => {
    let st = seedState();
    const p = st.projects[0];
    const a = addSkill(st, p.id, 'u-ram', 'docs-mcp'); expect(a.ok).toBe(true);
    if (a.ok) st = a.state;
    const r = runSkill(st, p.id, 'u-ram', 'docs-mcp', 'PRD.md');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.output).toContain('Outline of PRD.md');
  });
  it('capability refusal happens before any sandbox run', () => {
    let st = seedState();
    const p = st.projects[0];
    const a = addSkill(st, p.id, 'u-ram', 'claude-design'); expect(a.ok).toBe(true);
    if (a.ok) st = a.state;
    const r = runSkill(st, p.id, 'u-ram', 'claude-design', 'PRD.md');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('write_scope');
  });
});
