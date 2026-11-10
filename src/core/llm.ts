// Provider adapter. Keys are passed in per call and never stored, logged or put in error text.
// Groq adapter verified live 10 Nov 2026: one approved free-tier build from the app UI returned HTTP 200 with free-plan rate headers. Other providers remain fake-fetch-tested only.
export type ChatTurn = { role: 'system' | 'user' | 'assistant'; content: string };
export type LlmResult = { ok: true; text: string } | { ok: false; error: string };
export interface LlmProvider { id: string; complete(turns: ChatTurn[]): Promise<LlmResult> }

export const mockProvider = (reply = 'Mock reply. No real AI was called.'): LlmProvider => ({
  id: 'mock', complete: async () => ({ ok: true, text: reply }),
});

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

function mapHttpError(status: number): string | null {
  if (status === 401 || status === 403) return 'The provider rejected the key.';
  if (status === 429) return 'Rate limit reached. Stopped. Try again later.';
  if (status === 402) return 'The provider asked for payment. Stopped.';
  if (status >= 400) return `Provider error (${status}).`;
  return null;
}

/** OpenAI-compatible chat completions (OpenAI, Groq, xAI, NVIDIA NIM, Gemini OpenAI-compat).
 * The key goes only in the Authorization header, never in the body, URL or error text. */
export function openAiCompatProvider(opts: { id: string; baseUrl: string; apiKey: string; model: string; fetchImpl?: FetchLike; maxCalls?: number; timeoutMs?: number }): LlmProvider {
  const f = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  let calls = 0; const cap = opts.maxCalls ?? 8; // hard per-session cap so a loop cannot burn the free allowance
  return {
    id: opts.id,
    async complete(turns) {
      if (!opts.apiKey.trim()) return { ok: false, error: 'No API key set.' };
      if (!opts.model.trim()) return { ok: false, error: 'No model set.' };
      if (calls >= cap) return { ok: false, error: `Call cap of ${cap} reached. Nothing was sent.` };
      calls += 1;
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 30_000);
      try {
        const res = await f(`${opts.baseUrl}/chat/completions`, {
          method: 'POST', signal: ctl.signal,
          headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.apiKey}` },
          body: JSON.stringify({ model: opts.model, messages: turns }),
        });
        const httpErr = mapHttpError(res.status);
        if (httpErr) return { ok: false, error: httpErr };
        const j = await res.json(); const text = j?.choices?.[0]?.message?.content;
        return typeof text === 'string' && text ? { ok: true, text } : { ok: false, error: 'The provider returned no text.' };
      } catch { return { ok: false, error: 'The provider could not be reached.' }; }
      finally { clearTimeout(t); }
    },
  };
}

/** Anthropic Messages API. The key goes only in the x-api-key header. */
export function anthropicProvider(opts: { apiKey: string; model: string; fetchImpl?: FetchLike; maxCalls?: number; timeoutMs?: number }): LlmProvider {
  const f = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  let calls = 0; const cap = opts.maxCalls ?? 8;
  return {
    id: 'anthropic',
    async complete(turns) {
      if (!opts.apiKey.trim()) return { ok: false, error: 'No API key set.' };
      if (!opts.model.trim()) return { ok: false, error: 'No model set.' };
      if (calls >= cap) return { ok: false, error: `Call cap of ${cap} reached. Nothing was sent.` };
      calls += 1;
      const system = turns.filter((t) => t.role === 'system').map((t) => t.content).join('\n');
      const messages = turns.filter((t) => t.role !== 'system');
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 30_000);
      try {
        const res = await f('https://api.anthropic.com/v1/messages', {
          method: 'POST', signal: ctl.signal,
          headers: { 'content-type': 'application/json', 'x-api-key': opts.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
          body: JSON.stringify({ model: opts.model, max_tokens: 4096, system, messages }),
        });
        const httpErr = mapHttpError(res.status);
        if (httpErr) return { ok: false, error: httpErr };
        const j = await res.json();
        const text = Array.isArray(j?.content) ? j.content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('') : undefined;
        return typeof text === 'string' && text ? { ok: true, text } : { ok: false, error: 'The provider returned no text.' };
      } catch { return { ok: false, error: 'The provider could not be reached.' }; }
      finally { clearTimeout(t); }
    },
  };
}

export function groqProvider(apiKey: string, opts: { model?: string; fetchImpl?: FetchLike; maxCalls?: number; timeoutMs?: number } = {}): LlmProvider {
  return openAiCompatProvider({ id: 'groq', baseUrl: 'https://api.groq.com/openai/v1', apiKey, model: opts.model ?? 'openai/gpt-oss-120b', fetchImpl: opts.fetchImpl, maxCalls: opts.maxCalls, timeoutMs: opts.timeoutMs });
}
