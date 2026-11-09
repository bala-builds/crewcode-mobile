import type { Project, Task, ChatMessage } from './types';
import { ROOT_FILES } from './types';

export type Action = 'read' | 'write';

function member(p: Project, userId: string) { return p.members.find((m) => m.userId === userId); }
export function isOwner(p: Project, userId: string) { return p.ownerId === userId; }
export function isMember(p: Project, userId: string) { return !!member(p, userId); }

export function normalizePath(path: string): string | null {
  if (!path || path.includes('\0') || path.startsWith('/') || path.includes('\\')) return null;
  const parts = path.split('/');
  if (parts.some((s) => s === '..' || s === '.' )) return null;
  return parts.join('/');
}

/** Folders a user may write. Owner: whole project. Teammate: only the folders of their tasks. */
export function writableFolders(p: Project, userId: string): string[] {
  if (isOwner(p, userId)) return [''];
  return p.tasks.filter((t) => t.assigneeId === userId).map((t) => t.folder);
}

/** The single permission function. Every file read or write must go through it. */
export function canAccess(p: Project, userId: string, action: Action, rawPath: string): boolean {
  if (!isMember(p, userId)) return false;
  const path = normalizePath(rawPath);
  if (path === null) return false;
  if (isOwner(p, userId)) return true;
  const isRoot = (ROOT_FILES as readonly string[]).includes(path);
  if (isRoot) return action === 'read'; // teammates read the shared contract and PRD, never write them
  return writableFolders(p, userId).some((f) => f && path.startsWith(f));
}

export function visibleTasks(p: Project, userId: string): Task[] {
  if (!isMember(p, userId)) return [];
  if (isOwner(p, userId)) return p.tasks;
  return p.tasks.filter((t) => t.assigneeId === userId);
}

export function visibleMessages(p: Project, userId: string): ChatMessage[] {
  if (!isMember(p, userId)) return [];
  if (isOwner(p, userId)) return p.messages;
  const mine = new Set(p.tasks.filter((t) => t.assigneeId === userId).map((t) => t.id));
  return p.messages.filter((m) => m.authorId === userId || (m.taskId !== null && mine.has(m.taskId)));
}

export function visibleFiles(p: Project, userId: string): string[] {
  if (!isMember(p, userId)) return [];
  return Object.keys(p.files).filter((path) => canAccess(p, userId, 'read', path) || canAccess(p, userId, 'write', path)).sort();
}

/** Teammates see the member list names and interests only. AI access choices carry no keys, so they are visible. */
export function visibleMembers(p: Project, userId: string) {
  if (!isMember(p, userId)) return [];
  return p.members.map((m) => ({ userId: m.userId, role: m.role, interests: m.interests, ai: m.ai }));
}
