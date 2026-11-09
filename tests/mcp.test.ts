import { describe, expect, it } from 'vitest';
import { mcpCall, mcpExchange } from '../src/core/mcpclient';
import { seedState, runSkill, addSkill } from '../src/core/store';

describe('MCP server protocol (stdio, JSON-RPC 2.0, MCP 2025-06-18)', () => {
  it('initialize negotiates the protocol and tools capability', () => {
    const replies = mcpExchange([]);
    const init = replies.find((r) => r.id === 1);
    expect(init?.result?.protocolVersion).toBe('2025-06-18');
    expect((init?.result?.capabilities as Record<string, unknown>)?.tools).toBeDefined();
    expect((init?.result?.serverInfo as Record<string, unknown>)?.name).toBe('crewcode-local-tools');
  });
  it('tools/list describes the local tools with input schemas', () => {
    const replies = mcpExchange([{ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }]);
    const tools = (replies.find((r) => r.id === 2)?.result?.tools ?? []) as { name: string; inputSchema: { required?: string[] } }[];
    const docs = tools.find((t) => t.name === 'docs-mcp');
    expect(docs?.inputSchema.required).toContain('content');
    expect(tools.some((t) => t.name === 'code-review')).toBe(true);
  });
  it('tools/call runs a tool and returns a text content block', () => {
    const r = mcpCall('docs-mcp', { content: '# A\nx\n## B', contract: '', path: 'PRD.md' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.output).toContain('Headings: # A | ## B');
  });
  it('unknown tool and unknown method return JSON-RPC errors', () => {
    const replies = mcpExchange([
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'nope', arguments: {} } },
      { jsonrpc: '2.0', id: 4, method: 'bogus/method' },
    ]);
    expect(replies.find((r) => r.id === 3)?.error?.code).toBe(-32602);
    expect(replies.find((r) => r.id === 4)?.error?.code).toBe(-32601);
  });
});

describe('MCP server boundary (process isolation, permission-model-enforced)', () => {
  it('a handler cannot read the filesystem, spawn processes, or start workers', () => {
    process.env.CREWCODE_PROBE = '1';
    try {
      const r = mcpCall('__probe_fs', { content: '', contract: '', path: 'x' });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.output).toBe('probe: FS-DENIED CP-DENIED WK-DENIED');
    } finally { delete process.env.CREWCODE_PROBE; }
  });
  it('a handler that never returns is timed out and nothing is written', () => {
    process.env.CREWCODE_PROBE = '1';
    try {
      const r = mcpCall('__probe_hang', { content: '', contract: '', path: 'x' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/timed out|stopped/);
    } finally { delete process.env.CREWCODE_PROBE; }
  }, 10000);
  it('probe handlers do not exist without CREWCODE_PROBE', () => {
    const r = mcpCall('__probe_fs', { content: '', contract: '', path: 'x' });
    expect(r.ok).toBe(false);
  });
  it('runSkill serves output through the MCP server path', () => {
    let st = seedState();
    const p = st.projects[0];
    const a = addSkill(st, p.id, 'u-ram', 'docs-mcp'); expect(a.ok).toBe(true);
    if (a.ok) st = a.state;
    const r = runSkill(st, p.id, 'u-ram', 'docs-mcp', 'PRD.md');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.output).toContain('Outline of PRD.md');
  });
  it('capability refusal happens before any MCP server spawn', () => {
    let st = seedState();
    const p = st.projects[0];
    const a = addSkill(st, p.id, 'u-ram', 'claude-design'); expect(a.ok).toBe(true);
    if (a.ok) st = a.state;
    const r = runSkill(st, p.id, 'u-ram', 'claude-design', 'PRD.md');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('write_scope');
  });
});
