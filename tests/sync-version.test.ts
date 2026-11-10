import { describe, expect, it } from 'vitest';
import { Api } from '../src/server/api';
import { seedState } from '../src/core/store';

// Regression: a fresh seed or old persisted state had version undefined, so an open
// session's first version poll adopted the current counter as its baseline instead of
// noticing the change - teammates never saw work assigned after they opened the app.
describe('cross-session version baseline', () => {
  it('seed state starts with a numeric version', () => {
    expect(seedState().version).toBe(0);
  });
  it('Api normalizes a persisted state that has no version', () => {
    const stale = seedState() as unknown as Record<string, unknown>;
    delete stale.version;
    const api = new Api(stale as never);
    const v = api.call({ as: 'u-ram', op: 'getVersion' });
    expect(v.ok && (v.data as { version: number }).version).toBe(0);
    const p = api.call({ as: 'u-ram', op: 'listProjects' });
    expect(p.ok && (p.data as { stateVersion?: number }[])[0].stateVersion).toBe(0);
  });
  it('a change after the baseline is visible to another session poll', () => {
    const api = new Api();
    const lp = api.call({ as: 'u-ram', op: 'listProjects' });
    if (!lp.ok) throw new Error(lp.error);
    const pid = (lp.data as { id: string }[])[0].id;
    const before = api.call({ as: 'u-seeta', op: 'getProject', args: { projectId: pid } });
    if (!before.ok) throw new Error(before.error);
    const base = (before.data as { stateVersion?: number }).stateVersion;
    expect(base).toBe(0);
    api.call({ as: 'u-ram', op: 'assignTasks', args: { projectId: pid } });
    const after = api.call({ as: 'u-seeta', op: 'getVersion' });
    if (!after.ok) throw new Error(after.error);
    expect((after.data as { version: number }).version).toBeGreaterThan(base!);
  });
});
