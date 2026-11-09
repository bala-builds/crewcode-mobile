/**
 * Placeholder catalog. These are the names you gave ("claude design", "cloudflare security") plus labelled examples.
 * Nothing here is installed or runs. Availability, licence and what each really does are not verified (O8).
 */
export interface SkillItem {
  id: string; label: string; kind: 'skill' | 'mcp' | 'prebuilt';
  summary: string; permissions: string[]; verified: false;
}
export const CATALOG: SkillItem[] = [
  { id: 'claude-design', label: 'Claude Design', kind: 'prebuilt', summary: 'Design helper (placeholder name from your list). Not runnable in this build.', permissions: ['Read the shared contract', 'Write inside the member\'s own folder'], verified: false },
  { id: 'cloudflare-security', label: 'Local secret scan', kind: 'prebuilt', summary: 'Deterministic local scan of one in-scope file for key-shaped strings, findings masked. (From your list as "cloudflare security" - this is not the Cloudflare service.)', permissions: ['Read files in the member\'s own folder'], verified: false },
  { id: 'code-review', label: 'Local shared-name check', kind: 'skill', summary: 'Deterministic local check of one in-scope file: lists @shared names and compares them to CONTRACT.md. Not a general code review.', permissions: ['Read files in the member\'s own folder'], verified: false },
  { id: 'docs-mcp', label: 'Docs lookup', kind: 'mcp', summary: 'Example MCP: looks up documentation. Not runnable in this build.', permissions: ['Network access to documentation sites'], verified: false },
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
