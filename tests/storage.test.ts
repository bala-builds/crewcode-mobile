// Storage seam: the file adapter really round-trips state, the env picker
// selects it, and the status labels are honest about GitHub storage.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { JsonFileStorage, storageFromEnv, storageStatus } from '../server/storage';
import { seedState } from '../src/core/store';

describe('state storage', () => {
  it('JsonFileStorage round-trips state and reports missing files as undefined', () => {
    const f = '/tmp/crewcode-storage-test-' + Date.now() + '.json';
    const s = new JsonFileStorage(f);
    expect(s.load()).toBeUndefined();
    const st = seedState();
    s.save(st);
    const back = s.load();
    expect(back?.users.map((u) => u.name)).toEqual(st.users.map((u) => u.name));
    expect(back?.projects.map((p) => p.name)).toEqual(st.projects.map((p) => p.name));
    fs.rmSync(f, { force: true });
  });

  it('storageFromEnv honors CREWCODE_DATA and the status labels stay honest', () => {
    const s = storageFromEnv({ CREWCODE_DATA: '/tmp/x.json' });
    expect(s.describe()).toBe('local JSON file');
    const st = storageStatus(s);
    expect(st.storage).toBe('local JSON file');
    expect(String(st.githubStorage)).toContain('not-configured');
    expect(JSON.stringify(st)).not.toContain('connected');
  });
});
