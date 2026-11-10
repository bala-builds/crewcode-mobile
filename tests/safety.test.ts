import { describe, expect, it } from 'vitest';
import { hasKeyLike, scanForKeys } from '../src/core/keysafety';
import { groqProvider } from '../src/core/llm';
import { seedState, setAiAccess, setOwnerKeySharing, saveFile, fileRev, addSkill, approveSkill, removeSkill, assignTasks } from '../src/core/store';
import { skillCanAccess } from '../src/core/skills';

const KEY = 'gsk_AbCdEfGhIjKlMnOpQrStUvWx';
const turns = [{ role: 'user' as const, content: 'hi' }];

describe('Phase 5 key safety', () => {
  it('the scanner catches key-shaped strings and masks them', () => {
    const found = scanForKeys(`oops leaked ${KEY} here`);
    expect(found).toHaveLength(1);
    expect(found[0]).not.toContain(KEY);
    expect(hasKeyLike('nothing secret here')).toBe(false);
  });

  it('provider errors never contain the key, even when the API echoes it', async () => {
    for (const status of [401, 402, 429, 500] as const) {
      const r = await groqProvider(KEY, {
        fetchImpl: async () => ({ ok: false, status, json: async () => ({ error: { message: `bad key ${KEY}` } }) }),
      }).complete(turns);
      expect(r.ok).toBe(false);
      expect(JSON.stringify(r)).not.toContain(KEY);
      expect(hasKeyLike(JSON.stringify(r))).toBe(false);
    }
  });

  it('a bad key gets one clear error and no retry storm', async () => {
    let n = 0;
    const p = groqProvider(KEY, { fetchImpl: async () => { n++; return { ok: false, status: 401, json: async () => ({}) }; } });
    const r = await p.complete(turns);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('rejected');
    expect(n).toBe(1);
  });

  it('serialized app state never holds a key', () => {
    const s = seedState();
    expect(hasKeyLike(JSON.stringify(s))).toBe(false);
  });

  it('turning owner-key sharing off stops teammates at once', () => {
    let s = seedState();
    const p = s.projects[0];
    const r1 = setAiAccess(s, p.id, 'u-seeta', { kind: 'owner' });
    expect(r1.ok).toBe(true);
    if (r1.ok) s = r1.state;
    const r2 = setOwnerKeySharing(s, p.id, 'u-ram', false);
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      const m = r2.state.projects[0].members.find((x) => x.userId === 'u-seeta');
      expect(m?.ai).toBeUndefined(); // stopped at once
      const r3 = setAiAccess(r2.state, p.id, 'u-seeta', { kind: 'owner' });
      expect(r3.ok).toBe(false); // and cannot turn it back on
    }
  });
});

describe('Phase 7 skill scoping', () => {
  function setup() {
    let s = seedState();
    const p = s.projects[0];
    const r = assignTasks(s, p.id, 'u-ram');
    if (r.ok) s = r.state;
    return { s, p: s.projects[0] };
  }

  it('an installed, owner-approved skill works only inside the member folder scope', () => {
    const { s, p } = setup();
    const a = addSkill(s, p.id, 'u-ram', 'code-review');
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const st = a.state;
    const pr = st.projects[0];
    // Seeta's skill access follows Seeta's folders (home/ in the seeded plan)
    expect(skillCanAccess(pr, 'u-seeta', 'code-review', 'read', 'home/index.html')).toBe(true);
    expect(skillCanAccess(pr, 'u-seeta', 'code-review', 'read', 'outside/server.ts')).toBe(false);
    expect(skillCanAccess(pr, 'u-seeta', 'code-review', 'write', 'CONTRACT.md')).toBe(false);
  });

  it('a teammate-added skill has no access until the owner approves it', () => {
    const { s, p } = setup();
    const a = addSkill(s, p.id, 'u-seeta', 'code-review');
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    let pr = a.state.projects[0];
    expect(skillCanAccess(pr, 'u-seeta', 'code-review', 'read', 'home/index.html')).toBe(false);
    const ap = approveSkill(a.state, p.id, 'u-ram', 'code-review');
    expect(ap.ok).toBe(true);
    if (!ap.ok) return;
    pr = ap.state.projects[0];
    expect(skillCanAccess(pr, 'u-seeta', 'code-review', 'read', 'home/index.html')).toBe(true);
  });

  it('removing a skill removes its access', () => {
    const { s, p } = setup();
    const a = addSkill(s, p.id, 'u-ram', 'code-review');
    if (!a.ok) throw new Error('add failed');
    const rm = removeSkill(a.state, p.id, 'u-ram', 'code-review');
    expect(rm.ok).toBe(true);
    if (!rm.ok) return;
    expect(skillCanAccess(rm.state.projects[0], 'u-seeta', 'code-review', 'read', 'home/index.html')).toBe(false);
  });
});

describe('Phase 8 conflict handling', () => {
  it('a stale write is refused instead of silently overwriting', () => {
    const s = seedState();
    const p = s.projects[0];
    const rev0 = fileRev(s, p.id, 'PRD.md');
    const w1 = saveFile(s, p.id, 'u-ram', 'PRD.md', '# v2 by owner', rev0);
    expect(w1.ok).toBe(true);
    if (!w1.ok) return;
    // A second writer still holding rev0 is now stale.
    const w2 = saveFile(w1.state, p.id, 'u-ram', 'PRD.md', '# clobber', rev0);
    expect(w2.ok).toBe(false);
    if (!w2.ok) expect(w2.error).toContain('Conflict');
    // The first edit survived.
    expect(w1.state.projects[0].files['PRD.md']).toBe('# v2 by owner');
    // Writing with the fresh rev works.
    const w3 = saveFile(w1.state, p.id, 'u-ram', 'PRD.md', '# v3', fileRev(w1.state, p.id, 'PRD.md'));
    expect(w3.ok).toBe(true);
    if (w3.ok) expect(w3.state.projects[0].files['PRD.md']).toBe('# v3');
  });
});
