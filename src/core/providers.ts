import type { ProviderLabel } from './types';
import { openAiCompatProvider, anthropicProvider, type LlmProvider, type FetchLike } from './llm';

/**
 * Provider names are shown exactly as the user wrote them, mapped to the official API
 * endpoints (docs.x.ai, docs.nvidia.com, aistudio.google.com, platform.claude.com, api.openai.com).
 * "Grok" could mean xAI Grok or Groq (O4): the picker asks which one, nothing is assumed.
 */
export interface ProviderEndpoint { id: string; label: string; baseUrl: string; style: 'openai' | 'anthropic' }
export const PROVIDER_ENDPOINTS: Record<ProviderLabel, ProviderEndpoint[]> = {
  Gemini: [{ id: 'gemini', label: 'Google AI (Gemini)', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', style: 'openai' }],
  NVIDIA: [{ id: 'nvidia', label: 'NVIDIA NIM', baseUrl: 'https://integrate.api.nvidia.com/v1', style: 'openai' }],
  Grok: [
    { id: 'xai', label: 'xAI Grok', baseUrl: 'https://api.x.ai/v1', style: 'openai' },
    { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', style: 'openai' },
  ],
  Claude: [{ id: 'anthropic', label: 'Anthropic Claude', baseUrl: 'https://api.anthropic.com', style: 'anthropic' }],
  GPT: [{ id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', style: 'openai' }],
};
export interface ProviderInfo { label: ProviderLabel; status: 'key_needed'; note: string }
export const PROVIDERS: ProviderInfo[] = [
  { label: 'Gemini', status: 'key_needed', note: 'Real calls with your own key (Google AI).' },
  { label: 'NVIDIA', status: 'key_needed', note: 'Real calls with your own key (NVIDIA NIM).' },
  { label: 'Grok', status: 'key_needed', note: 'Real calls with your own key. Pick xAI Grok or Groq - the name covers both.' },
  { label: 'Claude', status: 'key_needed', note: 'Real calls with your own key (Anthropic).' },
  { label: 'GPT', status: 'key_needed', note: 'Real calls with your own key (OpenAI).' },
];

/** Own keys live in memory only. They are never put in app state, storage or messages. */
export interface KeyEntry { key: string; endpointId: string; model: string }
const ring = new Map<string, KeyEntry>();
export const keyring = {
  set(userId: string, provider: ProviderLabel, entry: KeyEntry) { ring.set(`${userId}:${provider}`, entry); },
  get(userId: string, provider: ProviderLabel): KeyEntry | undefined { return ring.get(`${userId}:${provider}`); },
  has(userId: string, provider: ProviderLabel) { return ring.has(`${userId}:${provider}`); },
  clear() { ring.clear(); },
};

/** Build a live provider from a stored key. Returns null when the entry or endpoint is unknown. */
export function providerFor(userId: string, provider: ProviderLabel, fetchImpl?: FetchLike): LlmProvider | null {
  const entry = keyring.get(userId, provider);
  if (!entry) return null;
  const ep = PROVIDER_ENDPOINTS[provider].find((e) => e.id === entry.endpointId);
  if (!ep) return null;
  return ep.style === 'anthropic'
    ? anthropicProvider({ apiKey: entry.key, model: entry.model, fetchImpl })
    : openAiCompatProvider({ id: ep.id, baseUrl: ep.baseUrl, apiKey: entry.key, model: entry.model, fetchImpl });
}

export function maskKey(key: string): string {
  if (key.length <= 4) return '••••';
  return '••••' + key.slice(-4);
}
