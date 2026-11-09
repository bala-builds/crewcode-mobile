// Provider adapter. Keys are passed in per call and never stored, logged or put in error text.
// The Groq adapter has only been tested against a fake fetch. No live call has been made in this repo.
export type ChatTurn = { role: 'system' | 'user' | 'assistant'; content: string };
export type LlmResult = { ok: true; text: string } | { ok: false; error: string };
export interface LlmProvider { id: string; complete(turns: ChatTurn[]): Promise<LlmResult> }

export const mockProvider = (reply = 'Mock reply. No real AI was called.'): LlmProvider => ({
  id: 'mock', complete: async () => ({ ok: true, text: reply }),
});

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

export function groqProvider(apiKey: string, opts: { model?: string; fetchImpl?: FetchLike; maxCalls?: number; timeoutMs?: number } = {}): LlmProvider {
  const f = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  let calls = 0; const cap = opts.maxCalls ?? 8; // hard per-session cap so a loop cannot burn the free allowance
  return {
    id: 'groq',
    async complete(turns) {
      if (!apiKey.trim()) return { ok: false, error: 'No API key set.' };
      if (calls >= cap) return { ok: false, error: `Call cap of ${cap} reached. Nothing was sent.` };
      calls += 1;
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 30_000);
      try {
        const res = await f('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST', signal: ctl.signal,
          headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model: opts.model ?? 'openai/gpt-oss-120b', messages: turns }),
        });
        if (res.status === 401 || res.status === 403) return { ok: false, error: 'The provider rejected the key.' };
        if (res.status === 429) return { ok: false, error: 'Rate limit reached. Stopped. Try again later.' };
        if (res.status === 402) return { ok: false, error: 'The provider asked for payment. Stopped.' };
        if (!res.ok) return { ok: false, error: `Provider error (${res.status}).` };
        const j = await res.json(); const text = j?.choices?.[0]?.message?.content;
        return typeof text === 'string' && text ? { ok: true, text } : { ok: false, error: 'The provider returned no text.' };
      } catch { return { ok: false, error: 'The provider could not be reached.' }; }
      finally { clearTimeout(t); }
    },
  };
}
