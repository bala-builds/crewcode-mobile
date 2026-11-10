import type { Task, Project } from './types';
import type { ChatTurn, LlmProvider } from './llm';

/** Task-scoped prompt builder. A caller gets only its task, contract, and folder files. */
export function buildTaskPrompt(
  task: Task,
  project: Pick<Project, 'name' | 'files'>,
  prompt: string,
): ChatTurn[] {
  const folderFiles = Object.entries(project.files)
    .filter(([path]) => path.startsWith(task.folder))
    .map(([path, content]) => `### ${path}\n${content}`)
    .join('\n\n');
  return [
    {
      role: 'system',
      content: [
        'You are the CrewCode build AI for exactly one task.',
        'Use only the task, shared contract and files in the assigned folder below.',
        `Write only inside ${task.folder}.`,
        'Return JSON only: {"message": string, "files": [{"path": string, "content": string}]}.',
        'Every file path must be a relative path inside the assigned folder.',
        'In "message", write a short structured summary: one line saying what was built, then 2 to 5 short bullets. Plain words, no headings, no walls of text.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `Project: ${project.name}`,
        `Task: ${task.title}`,
        `Detail: ${task.detail}`,
        `Assigned folder: ${task.folder}`,
        '',
        '## Shared contract',
        project.files['CONTRACT.md'] ?? '',
        '',
        '## Current files in the assigned folder',
        folderFiles || '(none)',
        '',
        '## Request',
        prompt,
      ].join('\n'),
    },
  ];
}

export type BuildOutput = { ok: true; message: string; files: Record<string, string> } | { ok: false; error: string };

/** Strictly parse build output. Bad paths, shapes or JSON are rejected, never partially kept. */
export function parseBuildJson(raw: string, folder: string): BuildOutput {
  const trimmed = raw.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return { ok: false, error: 'The AI reply did not contain a JSON object.' };
  let data: unknown;
  try { data = JSON.parse(trimmed.slice(start, end + 1)); } catch { return { ok: false, error: 'The AI reply was not valid JSON.' }; }
  const o = data as Record<string, unknown>;
  if (!o || typeof o !== 'object' || Array.isArray(o) || typeof o.message !== 'string' || !Array.isArray(o.files)) {
    return { ok: false, error: 'The AI reply was not a {message, files} object.' };
  }
  const files: Record<string, string> = {};
  for (const item of o.files) {
    const f = item as Record<string, unknown>;
    if (!f || typeof f.path !== 'string' || typeof f.content !== 'string') return { ok: false, error: 'A file entry was missing path or content.' };
    if (!f.path.startsWith(folder) || f.path.includes('..') || f.path.length > 200 || f.content.length > 200_000) {
      return { ok: false, error: `The AI tried to write an invalid path: ${f.path.slice(0, 80)}` };
    }
    files[f.path] = f.content;
  }
  return { ok: true, message: o.message, files };
}

/** Test/dev provider: deterministic, no network. The UI must label this as simulated. */
export function deterministicProvider(projectName: string): LlmProvider {
  return {
    id: 'deterministic-test',
    async complete(turns) {
      const user = turns.find((t) => t.role === 'user')?.content ?? '';
      void Promise.resolve();
      const folder = /Assigned folder: (\S+)/.exec(user)?.[1] ?? 'work/';
      const request = /## Request\n([\s\S]*)/.exec(user)?.[1]?.trim() ?? '';
      if (turns[0]?.content.includes('Divide the work')) {
        return { ok: false, error: 'Use the local deterministic planner in tests; this provider only builds task files.' };
      }
      const message = `Simulated build. No live AI was called.\n\n- Wrote the feature page (index.html)\n- Wrote the API route (api.ts)\n\nRequest received: ${request || '(none)'}.`;
      const files = {
        [`${folder}index.html`]: `<!doctype html>\n<html><body style="font-family:sans-serif;margin:0;padding:24px">\n<h1>${projectName}</h1>\n<p>Deterministic simulated build.</p>\n<p id="api">API: loading...</p>\n<script>fetch('/api/v1/health').then(r=>r.json()).then(j=>{document.getElementById('api').textContent='API says: '+j.status;}).catch(()=>{document.getElementById('api').textContent='API: not reachable';});</script>\n</body></html>\n`,
        // Plain-JS route module (no TS-only syntax, no imports): Preview runs it in a sandbox.
        [`${folder}api.ts`]: `// Simulated backend for this feature.\nexport async function handle({ method, path }) {\n  if (path === '/api/v1/health') return { status: 200, body: { status: 'ok' } };\n  return { status: 404, body: { error: 'not found' } };\n}\n`,
      };
      return { ok: true, text: JSON.stringify({ message, files: Object.entries(files).map(([path, content]) => ({ path, content })) }) };
    },
  };
}

/** Synchronous deterministic build used by the local test-identity API. */
export function deterministicBuild(projectName: string, folder: string, prompt: string): BuildOutput {
  void prompt;
  const message = 'Simulated build. No live AI was called.\n\n- Wrote the feature page (index.html)\n- Wrote the API route (api.ts)';
  const files = {
    [`${folder}index.html`]: `<!doctype html>\n<html><body style="font-family:sans-serif;margin:0;padding:24px">\n<h1>${projectName}</h1>\n<p>Deterministic simulated build.</p>\n<p id="api">API: loading...</p>\n<script>fetch('/api/v1/health').then(r=>r.json()).then(j=>{document.getElementById('api').textContent='API says: '+j.status;}).catch(()=>{document.getElementById('api').textContent='API: not reachable';});</script>\n</body></html>\n`,
    // Plain-JS route module (no TS-only syntax, no imports): Preview runs it in a sandbox.
        [`${folder}api.ts`]: `// Simulated backend for this feature.\nexport async function handle({ method, path }) {\n  if (path === '/api/v1/health') return { status: 200, body: { status: 'ok' } };\n  return { status: 404, body: { error: 'not found' } };\n}\n`,
  };
  return { ok: true, message, files };
}
