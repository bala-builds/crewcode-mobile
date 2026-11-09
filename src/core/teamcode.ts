import type { Project } from './types';

const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'; // no look-alike characters
export function generateTeamCode(rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  return `${s.slice(0, 3)}-${s.slice(3)}`;
}

export type JoinResult = { ok: true; project: Project } | { ok: false; reason: 'not_found' | 'revoked' | 'expired' | 'already_member' | 'used_up' };

export function findByCode(projects: Project[], code: string, userId: string, now = Date.now()): JoinResult {
  const norm = code.trim().toUpperCase().replace(/\s+/g, '');
  const withDash = norm.includes('-') ? norm : `${norm.slice(0, 3)}-${norm.slice(3)}`;
  const p = projects.find((x) => x.team.code === withDash);
  if (!p) return { ok: false, reason: 'not_found' };
  if (p.team.revoked) return { ok: false, reason: 'revoked' };
  if (p.team.expiresAt !== null && p.team.expiresAt < now) return { ok: false, reason: 'expired' };
  if (p.members.some((m) => m.userId === userId)) return { ok: false, reason: 'already_member' };
  const max = p.team.maxJoins ?? null;
  if (max !== null && (p.team.joinsUsed ?? 0) >= max) return { ok: false, reason: 'used_up' };
  return { ok: true, project: p };
}
