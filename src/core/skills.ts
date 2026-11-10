/**
 * Starter catalog. Real items the user named are mapped to what they actually are (O8):
 * "claude design" -> Anthropic's open-source frontend-design skill (github.com/anthropics/skills);
 * "cloudflare security" -> Cloudflare's official MCP servers (developers.cloudflare.com/agents/model-context-protocol).
 * Plus two local deterministic tools that really run in this build. Items whose declared
 * capabilities are only in-scope reads run locally as pure transforms; the rest are listed
 * with what they would need and cannot run yet.
 */
export type Capability = 'read_scope' | 'write_scope' | 'network' | 'execute';
export interface SkillItem {
  id: string; label: string; kind: 'skill' | 'mcp' | 'prebuilt';
  summary: string; permissions: string[]; verified: false;
  /** What the item says it needs. The runner enforces this: anything beyond local in-scope reads cannot run in this build. */
  caps: Capability[];
}
export const CATALOG: SkillItem[] = [
  { id: 'frontend-design', label: 'Claude Design (frontend-design skill)', kind: 'prebuilt', summary: 'Anthropic\'s open-source frontend-design skill: design guidance for building web interfaces (github.com/anthropics/skills). Needs to read the contract and write design files into your folder; not runnable in this build.', permissions: ['Read the shared contract', 'Write inside the member\'s own folder'], verified: false, caps: ['read_scope', 'write_scope'] },
  { id: 'cloudflare-security', label: 'Cloudflare security MCP', kind: 'mcp', summary: 'Cloudflare\'s official MCP servers for security and Zero Trust configuration (developers.cloudflare.com). Remote service: needs network access and your Cloudflare account. Not runnable in this build.', permissions: ['Network access to Cloudflare', 'Your Cloudflare account'], verified: false, caps: ['network', 'execute'] },
  { id: 'secret-scan', label: 'Local secret scan', kind: 'prebuilt', summary: 'Deterministic local scan of one in-scope file for key-shaped strings, findings masked. Runs here, no network.', permissions: ['Read files in the member\'s own folder'], verified: false, caps: ['read_scope'] },
  { id: 'code-review', label: 'Local shared-name check', kind: 'skill', summary: 'Deterministic local check of one in-scope file: lists @shared names and compares them to CONTRACT.md. Not a general code review. Runs here, no network.', permissions: ['Read files in the member\'s own folder'], verified: false, caps: ['read_scope'] },
  { id: 'docs-mcp', label: 'Docs outline', kind: 'mcp', summary: 'Local MCP tool: outlines one in-scope document (headings and line count). Runs locally; no network.', permissions: ['Read files in the member\'s own scope'], verified: false, caps: ['read_scope'] },
];
export function searchCatalog(q: string): SkillItem[] {
  const s = q.trim().toLowerCase();
  return s ? CATALOG.filter((c) => (c.label + ' ' + c.kind + ' ' + c.summary).toLowerCase().includes(s)) : CATALOG;
}

import type { Project } from './types';
import { canAccess, type Action } from './permissions';

/**
 * The one gate every skill run must pass. A skill acts for a member and is held to that
 * member's folder scope - the same rule as a person. It must be installed and, when a
 * teammate added it, approved by the owner first. Removing the skill ends its access.
 */
export function skillCanAccess(p: Project, userId: string, skillId: string, action: Action, path: string): boolean {
  const s = p.skills.find((x) => x.id === skillId);
  if (!s) return false;
  if (!s.approvedByOwner) return false;
  return canAccess(p, userId, action, path);
}

/** A tool can run locally only when every capability it declares is an in-scope read. */
export function localRunnable(item: SkillItem): boolean {
  return item.caps.length > 0 && item.caps.every((c) => c === 'read_scope');
}
