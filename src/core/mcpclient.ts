/**
 * Minimal MCP client. Spawns the local MCP server (stdio) under Node's permission model -
 * the same enforced boundary as before: no filesystem outside the bundle, no writes, no
 * child processes, no worker threads (probe-proven). Network is NOT runtime-enforced.
 * The lifecycle and one call are pipelined on stdin; replies are matched by id.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const SERVER = path.resolve('dist-mcp/server-entry.js');
const PKG = path.resolve('package.json');
const TIMEOUT_MS = 3000;

export interface McpReply { id?: unknown; result?: Record<string, unknown>; error?: { code: number; message: string } }

export function mcpExchange(extra: Record<string, unknown>[]): McpReply[] {
  const lines = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'crewcode', version: '0.1.0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    ...extra,
  ].map((m) => JSON.stringify(m)).join('\n') + '\n';
  const out = execFileSync(process.execPath, [
    '--experimental-permission',
    `--allow-fs-read=${path.dirname(SERVER)}`,
    `--allow-fs-read=${PKG}`,
    SERVER,
  ], {
    input: lines,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    env: process.env.CREWCODE_PROBE === '1' ? { CREWCODE_PROBE: '1' } : {},
    maxBuffer: 1024 * 1024,
  });
  return out.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as McpReply);
}

export function mcpCall(tool: string, args: Record<string, string>): { ok: true; output: string } | { ok: false; error: string } {
  try {
    const replies = mcpExchange([{ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: args } }]);
    const init = replies.find((r) => r.id === 1);
    if (!init?.result || !(init.result.capabilities as Record<string, unknown>)?.tools) return { ok: false, error: 'MCP initialize failed.' };
    const call = replies.find((r) => r.id === 2);
    if (!call) return { ok: false, error: 'No MCP response to tools/call.' };
    if (call.error) return { ok: false, error: call.error.message };
    const res = call.result ?? {};
    const block = (res.content as { type: string; text: string }[] | undefined)?.[0];
    if (res.isError) return { ok: false, error: block?.text ?? 'Tool error.' };
    return { ok: true, output: block?.text ?? '' };
  } catch (e) {
    const timed = e instanceof Error && ('signal' in e || /ETIMEDOUT|timed out/i.test(e.message));
    return { ok: false, error: timed ? 'Tool timed out or was stopped.' : `Tool run failed: ${(e instanceof Error ? e.message : String(e)).split('\n')[0]}` };
  }
}
