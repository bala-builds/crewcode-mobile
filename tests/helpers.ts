import { seedState, joinProject, assignTasks, setAiAccess, createProject } from '../src/core/store';
import type { AppState } from '../src/core/types';

export function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error('expected ok: ' + JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
}
/** Project with owner Ram, teammates Seeta (frontend) and Hanuma (backend), tasks assigned. */
export function teamState(): { state: AppState; pid: string } {
  let s = seedState();
  const pid = s.projects[0].id;
  s = ok(joinProject(s, 'u-hanuma', 'DEM-123', ['backend', 'api'])).state;
  s = ok(assignTasks(s, pid, 'u-ram')).state;
  s = ok(setAiAccess(s, pid, 'u-hanuma', { kind: 'owner' })).state;
  return { state: s, pid };
}
export { createProject };
