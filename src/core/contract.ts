/**
 * CONTRACT.md format (owner-controlled):
 *   ## Shared names
 *   - API_BASE
 *   - PROJECT_NAME
 *   ## Folder ownership
 *   - frontend/ : Ram
 * The integration check finds names that a teammate's code uses but the contract does not list,
 * and contract names that are redefined with a different value in another folder.
 */
export function parseSharedNames(contract: string): string[] {
  const out: string[] = [];
  let inSection = false;
  for (const line of contract.split('\n')) {
    if (/^##\s+Shared names/i.test(line)) { inSection = true; continue; }
    if (/^##\s+/.test(line)) { inSection = false; continue; }
    const m = inSection && line.match(/^-\s+([A-Z][A-Z0-9_]*)\b/);
    if (m) out.push(m[1]);
  }
  return out;
}

export interface Finding { path: string; name: string; problem: 'unlisted_shared_name' }

/** A "mark" is an ALL_CAPS identifier written as MARK_NAME (e.g. API_BASE). Unlisted marks are flagged. */
export function integrationCheck(contract: string, files: Record<string, string>, folder: string): Finding[] {
  const allowed = new Set(parseSharedNames(contract));
  const findings: Finding[] = [];
  for (const [path, content] of Object.entries(files)) {
    if (!path.startsWith(folder)) continue;
    for (const m of content.matchAll(/@shared\s+([A-Z][A-Z0-9_]*)/g)) {
      if (!allowed.has(m[1])) findings.push({ path, name: m[1], problem: 'unlisted_shared_name' });
    }
  }
  return findings;
}

export function defaultContract(projectName: string, folders: { folder: string; owner: string }[] = []): string {
  return [
    `# Shared contract for ${projectName}`,
    '',
    'Owner-controlled. Teammates can read this file, not change it.',
    'Mark shared names in code as `@shared NAME`.',
    '',
    '## Shared names',
    '- PROJECT_NAME',
    '- API_BASE',
    '- THEME_COLOR',
    '',
    '## Folder ownership',
    ...folders.map((f) => `- ${f.folder} : ${f.owner}`),
    '',
  ].join('\n');
}
