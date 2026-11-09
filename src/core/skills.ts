/**
 * Placeholder catalog. These are the names you gave ("claude design", "cloudflare security") plus labelled examples.
 * Availability, licence and what each really does are not verified (O8). Items whose declared capabilities are
 * only in-scope reads run locally as pure transforms; the rest are listed with what they would need.
 */
export type Capability = 'read_scope' | 'write_scope' | 'network' | 'execute';
export interface SkillItem {
  id: string; label: string; kind: 'skill' | 'mcp' | 'prebuilt';
  summary: string; permissions: string[]; verified: false;
  /** What the item says it needs. The runner enforces this: anything beyond local in-scope reads cannot run in this build. */
  caps: Capability[];
}
export const CATALOG: SkillItem[] = [
  { id: 'claude-design', label: 'Claude Design', kind: 'prebuilt', summary: 'Design helper (placeholder name from your list). Not runnable in this build.', permissions: ['Read the shared contract', 'Write inside the member\'s own folder'], verified: false, caps: ['read_scope', 'write_scope'] },
  { id: 'cloudflare-security', label: 'Local secret scan', kind: 'prebuilt', summary: 'Deterministic local scan of one in-scope file for key-shaped strings, findings masked. (From your list as "cloudflare security" - this is not the Cloudflare service.)', permissions: ['Read files in the member\'s own folder'], verified: false, caps: ['read_scope'] },
  { id: 'code-review', label: 'Local shared-name check', kind: 'skill', summary: 'Deterministic local check of one in-scope file: lists @shared names and compares them to CONTRACT.md. Not a general code review.', permissions: ['Read files in the member\'s own folder'], verified: false, caps: ['read_scope'] },
  { id: 'docs-mcp', label: 'Docs outline', kind: 'mcp', summary: 'Example MCP-shaped tool: outlines one in-scope document (headings and line count). Runs locally; no network.', permissions: ['Read files in the member\'s own scope'], verified: false, caps: ['read_scope'] },
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
