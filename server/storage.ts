// State storage seam. Today there is exactly one real adapter: the local JSON
// file. GitHub-as-storage (user's chosen direction) slots in here once the App
// private key is installed - it needs installation tokens, which need that key.
// Until then there is deliberately NO GitHub adapter stub: an unimplemented
// class that throws would be a fake capability. The status route reports the
// real state instead.
import fs from 'node:fs';
import type { AppState } from '../src/core/types';

export interface StateStorage {
  load(): AppState | undefined;
  save(state: AppState): void;
  /** Honest human-readable label for status reporting. */
  describe(): string;
}

export class JsonFileStorage implements StateStorage {
  constructor(private file: string) {}
  load(): AppState | undefined {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return undefined; }
  }
  save(state: AppState): void {
    fs.writeFileSync(this.file, JSON.stringify(state));
  }
  describe(): string { return 'local JSON file'; }
}

export function storageFromEnv(env: Record<string, string | undefined>): StateStorage {
  return new JsonFileStorage(env.CREWCODE_DATA ?? new URL('./data.json', import.meta.url).pathname);
}

/** Reported by the status route so the UI never implies GitHub persistence. */
export function storageStatus(storage: StateStorage): Record<string, unknown> {
  return {
    storage: storage.describe(),
    githubStorage: 'not-configured: the CrewCode GitHub App private key is not installed on this server yet',
  };
}
