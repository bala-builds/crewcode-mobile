/**
 * Genuine MCP server: stdio transport, newline-delimited JSON-RPC 2.0, MCP lifecycle
 * (initialize / notifications/initialized), tools/list and tools/call per the
 * Model Context Protocol 2025-06-18. Serves the in-repo local tool handlers.
 * Runs under Node's permission model when spawned by mcpclient.ts.
 */
import { LOCAL_TOOL_HANDLERS } from '../core/toolhandlers';
import { CATALOG } from '../core/skills';

const PROTOCOL_VERSION = '2025-06-18';

type Json = Record<string, unknown>;
const result = (id: unknown, r: Json) => JSON.stringify({ jsonrpc: '2.0', id, result: r });
const errReply = (id: unknown, code: number, message: string) => JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });

function handle(msg: { id?: unknown; method?: string; params?: { name?: unknown; arguments?: Record<string, unknown> } }): string | null {
  const { id, method, params } = msg;
  switch (method) {
    case 'initialize':
      return result(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: 'crewcode-local-tools', version: '0.1.0' } });
    case 'notifications/initialized':
      return null;
    case 'ping':
      return result(id, {});
    case 'tools/list': {
      const tools = Object.keys(LOCAL_TOOL_HANDLERS).map((name) => {
        const cat = CATALOG.find((c) => c.id === name);
        return {
          name,
          title: cat?.label ?? name,
          description: cat?.summary ?? 'local tool',
          inputSchema: {
            type: 'object',
            properties: {
              content: { type: 'string', description: 'Content of the single in-scope file.' },
              contract: { type: 'string', description: 'CONTRACT.md content for checks.' },
              path: { type: 'string', description: 'Path of the file being examined.' },
            },
            required: ['content', 'path'],
          },
        };
      });
      return result(id, { tools });
    }
    case 'tools/call': {
      const name = typeof params?.name === 'string' ? params.name : '';
      const fn = LOCAL_TOOL_HANDLERS[name];
      if (!fn) return errReply(id, -32602, `Unknown tool: ${name || '(missing)'}`);
      try {
        const a = params?.arguments ?? {};
        const text = fn(String(a.content ?? ''), String(a.contract ?? ''), String(a.path ?? ''));
        return result(id, { content: [{ type: 'text', text }], isError: false });
      } catch (e) {
        return result(id, { content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true });
      }
    }
    default:
      return id === undefined ? null : errReply(id, -32601, 'Method not found');
  }
}

let buffer = '';
process.stdin.on('data', (c: Buffer) => {
  buffer += c.toString('utf8');
  let i: number;
  while ((i = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, i).trim();
    buffer = buffer.slice(i + 1);
    if (!line) continue;
    try {
      const reply = handle(JSON.parse(line));
      if (reply) console.log(reply);
    } catch {
      console.log(errReply(null, -32700, 'Parse error'));
    }
  }
});
