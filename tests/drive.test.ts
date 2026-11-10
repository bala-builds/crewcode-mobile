import { describe, it, expect } from 'vitest';
import { backupFileName, buildMultipartBody, driveStatus, uploadBackup } from '../src/core/drive';

describe('drive wiring (code path only)', () => {
  it('stays inert without a confirmed OAuth client id, on minimum drive.file scope', () => {
    const off = driveStatus({});
    expect(off.configured).toBe(false);
    expect(off.scope).toBe('drive.file');
    expect(off.reason).toContain('no confirmed Google OAuth client ID');
    expect(driveStatus({ clientId: '  ' }).configured).toBe(false);
    expect(driveStatus({ clientId: 'x.apps.googleusercontent.com' }).configured).toBe(true);
  });

  it('names backups deterministically and safely', () => {
    const n = backupFileName('Habit Tracker!', Date.UTC(2026, 10, 10));
    expect(n).toBe('crewcode-backup-habit-tracker-2026-11-10.json');
  });

  it('multipart body carries metadata then content, and never the token', () => {
    const { contentType, body } = buildMultipartBody('b.json', '{"a":1}');
    expect(contentType).toContain('multipart/related');
    expect(body).toContain('"name":"b.json"');
    expect(body).toContain('{"a":1}');
    expect(body).not.toContain('Bearer');
  });

  it('refuses to upload without a token or with an empty backup, before any request', async () => {
    let calls = 0;
    const spy: typeof fetch = async () => { calls++; return new Response('{}', { status: 200 }); };
    expect((await uploadBackup(' ', 'b.json', '{}', spy)).ok).toBe(false);
    expect((await uploadBackup('tok', 'b.json', ' ', spy)).ok).toBe(false);
    expect(calls).toBe(0);
  });

  it('maps HTTP outcomes to honest messages that never carry the token', async () => {
    const mk = (status: number, payload = '{}'): typeof fetch =>
      async () => new Response(payload, { status });
    const r401 = await uploadBackup('tok-SECRET', 'b.json', '{}', mk(401)); expect(r401.ok).toBe(false); if (!r401.ok) expect(r401.error).toContain('401');
    const r403 = await uploadBackup('tok-SECRET', 'b.json', '{}', mk(403)); expect(r403.ok).toBe(false); if (!r403.ok) expect(r403.error).toContain('403');
    const r500 = await uploadBackup('tok-SECRET', 'b.json', '{}', mk(500)); expect(r500.ok).toBe(false); if (!r500.ok) expect(r500.error).toContain('500');
    const ok = await uploadBackup('tok-SECRET', 'b.json', '{}', mk(200, '{"id":"file-1"}'));
    expect(ok).toEqual({ ok: true, fileId: 'file-1' });
    for (const s of [401, 403, 500]) {
      const r = await uploadBackup('tok-SECRET', 'b.json', '{}', mk(s));
      if (!r.ok) expect(r.error).not.toContain('tok-SECRET');
    }
  });
});
