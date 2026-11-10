/**
 * Phase 9 Google Drive wiring (code path only).
 *
 * The user's standing choice (O9): project code lives in the user's OWN Google Drive.
 * This module implements the upload path against the Drive v3 multipart API, but stays
 * inert until a confirmed OAuth client ID is configured and the user completes Google's
 * own consent screen in the browser. No OAuth client is created or reused by this code;
 * a prior Google Cloud project of the owner's is a lead, not permission.
 *
 * Scope discipline: requests are built for the minimum `drive.file` scope (only files
 * this app itself created). The access token is held in memory by the caller, never
 * written to disk or the project store, and never appears in an error message.
 */

export interface DriveConfig {
  /** Google OAuth client ID for this app. Empty/absent = not configured. */
  clientId?: string;
}

export interface DriveStatus {
  configured: boolean;
  scope: 'drive.file';
  reason?: string;
}

export function driveStatus(config: DriveConfig): DriveStatus {
  if (!config.clientId || !config.clientId.trim()) {
    return {
      configured: false,
      scope: 'drive.file',
      reason: 'Google Drive is not connected yet: this build has no confirmed Google OAuth client ID, so the Drive button stays off.',
    };
  }
  return { configured: true, scope: 'drive.file' };
}

export function backupFileName(projectName: string, savedAt: number): string {
  const safe = projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
  const day = new Date(savedAt).toISOString().slice(0, 10);
  return `crewcode-backup-${safe}-${day}.json`;
}

/** Drive v3 multipart/related upload body: metadata part then JSON content part. */
export function buildMultipartBody(fileName: string, json: string): { contentType: string; body: string } {
  const boundary = 'crewcode-drive-boundary';
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify({ name: fileName, mimeType: 'application/json' }),
    `--${boundary}`,
    'Content-Type: application/json',
    '',
    json,
    `--${boundary}--`,
    '',
  ].join('\r\n');
  return { contentType: `multipart/related; boundary=${boundary}`, body };
}

export type UploadResult = { ok: true; fileId: string } | { ok: false; error: string };

const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';

export async function uploadBackup(
  accessToken: string,
  fileName: string,
  json: string,
  fetchImpl: typeof fetch = fetch,
): Promise<UploadResult> {
  if (!accessToken.trim()) return { ok: false, error: 'Drive upload refused: no Google access token. Connect Google Drive first.' };
  if (!json.trim()) return { ok: false, error: 'Drive upload refused: empty backup.' };
  const { contentType, body } = buildMultipartBody(fileName, json);
  let res: Response;
  try {
    res = await fetchImpl(UPLOAD_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': contentType },
      body,
    });
  } catch {
    return { ok: false, error: 'Drive upload failed: network error. The backup was not saved to Drive.' };
  }
  if (res.status === 401) return { ok: false, error: 'Google refused the token (401). Reconnect Google Drive.' };
  if (res.status === 403) return { ok: false, error: 'Google refused the upload (403). Check the drive.file scope consent.' };
  if (!res.ok) return { ok: false, error: `Drive upload failed (HTTP ${res.status}). The backup was not saved.` };
  const data = (await res.json().catch(() => ({}))) as { id?: string };
  if (!data.id) return { ok: false, error: 'Drive answered without a file id; upload not confirmed.' };
  return { ok: true, fileId: data.id };
}
