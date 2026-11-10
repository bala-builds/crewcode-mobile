// Real AI flow: a member with their own key runs start -> provider -> apply through the
// API ops. The provider call itself is fake (no live key, no network); the scope gates,
// stop-discard rule and simulated labeling are what is proven here.
import { describe, it, expect } from 'vitest';
import { Api } from '../src/server/api';
import { mockProvider, openAiCompatProvider, anthropicProvider } from '../src/core/llm';
import { providerFor, keyring } from '../src/core/providers';
import { buildTaskPrompt, parseBuildJson } from '../src/core/execution';
import { planWithProvider } from '../src/core/planner';

const call = (api: Api, as: string, op: string, args: Record<string, any> = {}) => api.call({ as, op, args });

function setup() {
  const api = new Api();
  const pid = api.state.projects[0].id;
  call(api, 'u-hanuma', 'joinProject', { code: 'DEM-123', interests: ['backend'] });
  call(api, 'u-ram', 'assignTasks', { projectId: pid });
  return { api, pid };
}

describe('real build flow through start/apply ops (fake provider)', () => {
  it('an own-key build lands files in scope and the message is not labeled simulated', async () => {
    const { api, pid } = setup();
    call(api, 'u-seeta', 'setAiAccess', { projectId: pid, access: { kind: 'own', provider: 'Grok' } });
    keyring.set('u-seeta', 'Grok', { key: 'TESTKEY-1', endpointId: 'groq', model: 'test-model' });
    const provider = providerFor('u-seeta', 'Grok', async (u, i) => {
      expect(u).toBe('https://api.groq.com/openai/v1/chat/completions');
      expect(i.headers.authorization).toBe('Bearer TESTKEY-1');
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ message: 'Built the screen.', files: [{ path: 'frontend/index.html', content: '<h1>real</h1>' }] }) } }] }) };
    })!;
    const task = api.state.projects[0].tasks.find((t) => t.assigneeId === 'u-seeta')!;
    expect(call(api, 'u-seeta', 'startTaskRun', { projectId: pid, taskId: task.id }).ok).toBe(true);
    const res = await provider.complete(buildTaskPrompt(task, { name: 'Habit Tracker', files: api.state.projects[0].files }, 'build it'));
    expect(res.ok).toBe(true);
    const result = res.ok ? parseBuildJson(res.text, task.folder) : res;
    expect(result.ok).toBe(true);
    const applied = call(api, 'u-seeta', 'applyTaskRun', { projectId: pid, taskId: task.id, result, simulated: false });
    expect(applied.ok).toBe(true);
    const p = api.state.projects[0];
    expect(p.files['frontend/index.html']).toBe('<h1>real</h1>');
    const msg = p.messages.at(-1)!;
    expect(msg.kind).toBe('ai_build');
    expect(msg.simulated).toBe(false);
    expect(msg.text).not.toContain('Simulated');
  });

  it('a provider reply outside the folder is refused and nothing is written', async () => {
    const { api, pid } = setup();
    call(api, 'u-seeta', 'setAiAccess', { projectId: pid, access: { kind: 'own', provider: 'GPT' } });
    keyring.set('u-seeta', 'GPT', { key: 'TESTKEY-2', endpointId: 'openai', model: 'test-model' });
    const provider = providerFor('u-seeta', 'GPT', async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ message: 'sneaky', files: [{ path: 'backend/evil.ts', content: 'x' }] }) } }] }) }))!;
    const task = api.state.projects[0].tasks.find((t) => t.assigneeId === 'u-seeta')!;
    call(api, 'u-seeta', 'startTaskRun', { projectId: pid, taskId: task.id });
    const res = await provider.complete(buildTaskPrompt(task, { name: 'Habit Tracker', files: {} }, ''));
    const parsed = res.ok ? parseBuildJson(res.text, task.folder) : res;
    expect(parsed.ok).toBe(false); // parser rejects the out-of-folder path
    const applied = call(api, 'u-seeta', 'applyTaskRun', { projectId: pid, taskId: task.id, result: parsed, simulated: false });
    expect(applied.ok).toBe(true);
    const p = api.state.projects[0];
    expect(p.files['backend/evil.ts']).toBeUndefined();
    expect(p.messages.at(-1)!.kind).toBe('ai_error');
  });

  it('only the assignee (or owner) can apply a result, and a stopped run discards it', async () => {
    const { api, pid } = setup();
    const task = api.state.projects[0].tasks.find((t) => t.assigneeId === 'u-seeta')!;
    call(api, 'u-seeta', 'startTaskRun', { projectId: pid, taskId: task.id });
    const result = { ok: true, message: 'm', files: { 'frontend/a.txt': 'a' } };
    expect(call(api, 'u-hanuma', 'applyTaskRun', { projectId: pid, taskId: task.id, result, simulated: false }).ok).toBe(false);
    // Stop the run; the late provider result is discarded.
    call(api, 'u-seeta', 'cancelTaskRun', { projectId: pid, taskId: task.id });
    const applied = call(api, 'u-seeta', 'applyTaskRun', { projectId: pid, taskId: task.id, result, simulated: false });
    expect(applied.ok && applied.data?.discarded).toBe(true);
    expect(api.state.projects[0].files['frontend/a.txt']).toBeUndefined();
  });

  it('owner planning with a real key posts an unlabeled plan; teammates cannot apply one', async () => {
    const { api, pid } = setup();
    call(api, 'u-ram', 'setAiAccess', { projectId: pid, access: { kind: 'owner', provider: 'Claude' } });
    keyring.set('u-ram', 'Claude', { key: 'TESTKEY-3', endpointId: 'anthropic', model: 'claude-test' });
    const plan = [{ title: 'Screens', detail: 'd', assignee: 'Seeta', folder: 'frontend/' }, { title: 'API', detail: 'd', assignee: 'Hanuma', folder: 'backend/' }];
    const provider = anthropicProvider({ apiKey: 'TESTKEY-3', model: 'claude-test', fetchImpl: async (u, i) => {
      expect(u).toBe('https://api.anthropic.com/v1/messages');
      expect(i.headers['x-api-key']).toBe('TESTKEY-3');
      return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(plan) }] }) };
    } });
    expect(call(api, 'u-ram', 'startPlanning', { projectId: pid }).ok).toBe(true);
    const proj = api.state.projects[0];
    const outcome = await planWithProvider(provider, { name: proj.name, files: proj.files, members: proj.members.filter((m) => m.role === 'teammate') }, api.state.users);
    expect(outcome.ok).toBe(true);
    expect(call(api, 'u-seeta', 'applyPlanning', { projectId: pid, outcome, simulated: false }).ok).toBe(false);
    const applied = call(api, 'u-ram', 'applyPlanning', { projectId: pid, outcome, simulated: false });
    expect(applied.ok).toBe(true);
    const msg = api.state.projects[0].messages.at(-1)!;
    expect(msg.kind).toBe('ai_plan');
    expect(msg.simulated).toBe(false);
    expect(msg.text).toContain('Plan:');
    expect(msg.text).not.toContain('Simulated');
  });

  it('providerFor returns null without a stored key, so the flow stays simulated', () => {
    keyring.clear();
    expect(providerFor('u-seeta', 'Grok')).toBeNull();
    expect(mockProvider().id).toBe('mock');
  });
});
