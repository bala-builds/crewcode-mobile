import type { AppState, Project } from './types';

/**
 * Phase 8 backup and restore. Owner only. Export is a plain JSON snapshot of one project.
 * Restore replaces the project wholesale and bumps every file revision, so an editor
 * holding a pre-restore revision conflicts instead of silently overwriting the restore.
 */

export interface ProjectBackup {
  format: 'crewcode-backup';
  version: 1;
  savedAt: number;
  project: Project;
}

export type BackupResult = { ok: true; json: string } | { ok: false; error: string };
export type RestoreResult = { ok: true; state: AppState; projectId: string } | { ok: false; error: string };

export function exportProject(state: AppState, projectId: string, userId: string): BackupResult {
  const p = state.projects.find((x) => x.id === projectId);
  if (!p) return { ok: false, error: 'Project not found.' };
  if (p.ownerId !== userId) return { ok: false, error: 'Only the owner can export a backup.' };
  const backup: ProjectBackup = { format: 'crewcode-backup', version: 1, savedAt: Date.now(), project: structuredClone(p) };
  return { ok: true, json: JSON.stringify(backup, null, 2) };
}

function isProjectShape(x: unknown): x is Project {
  const p = x as Project;
  return !!p && typeof p === 'object'
    && typeof p.id === 'string' && typeof p.name === 'string'
    && Array.isArray(p.members) && Array.isArray(p.tasks) && Array.isArray(p.messages)
    && !!p.files && typeof p.files === 'object';
}

export function restoreProject(state: AppState, userId: string, json: string): RestoreResult {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { ok: false, error: 'That backup file is not valid JSON.' };
  }
  const b = data as Partial<ProjectBackup>;
  if (b?.format !== 'crewcode-backup' || b.version !== 1 || !isProjectShape(b.project)) {
    return { ok: false, error: 'That file is not a CrewCode backup.' };
  }
  const existing = state.projects.find((x) => x.id === b.project!.id);
  if (!existing) return { ok: false, error: 'No project with that ID exists here. Restoring as a new project is not supported yet.' };
  if (existing.ownerId !== userId) return { ok: false, error: 'Only the owner can restore a backup.' };
  const next = structuredClone(state);
  const idx = next.projects.findIndex((x) => x.id === existing.id);
  const restored = structuredClone(b.project!);
  // Bump every revision past both sides so any open editor conflicts loudly.
  const revs: Record<string, number> = {};
  const paths = new Set([...Object.keys(restored.files), ...Object.keys(existing.fileRevs ?? {})]);
  for (const path of paths) {
    revs[path] = Math.max(restored.fileRevs?.[path] ?? 0, existing.fileRevs?.[path] ?? 0) + 1;
  }
  restored.fileRevs = revs;
  next.projects[idx] = restored;
  return { ok: true, state: next, projectId: restored.id };
}
