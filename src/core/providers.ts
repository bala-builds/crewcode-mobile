import type { ProviderLabel } from './types';

/**
 * Provider names are shown exactly as the user wrote them. They are UI labels, not verified integrations.
 * "Grok" could mean xAI Grok or Groq. That is an open decision (O4). No real provider is called by this build.
 */
export interface ProviderInfo { label: ProviderLabel; status: 'placeholder'; note: string }
export const PROVIDERS: ProviderInfo[] = [
  { label: 'Gemini', status: 'placeholder', note: 'Not connected' },
  { label: 'NVIDIA', status: 'placeholder', note: 'Not connected' },
  { label: 'Grok', status: 'placeholder', note: 'Not connected. Name needs your confirmation (xAI Grok or Groq).' },
  { label: 'Claude', status: 'placeholder', note: 'Not connected' },
  { label: 'GPT', status: 'placeholder', note: 'Not connected' },
];

/** Own keys live in memory only. They are never put in app state, storage or messages. */
const ring = new Map<string, string>();
export const keyring = {
  set(userId: string, provider: ProviderLabel, key: string) { ring.set(`${userId}:${provider}`, key); },
  has(userId: string, provider: ProviderLabel) { return ring.has(`${userId}:${provider}`); },
  clear() { ring.clear(); },
};

export function maskKey(key: string): string {
  if (key.length <= 4) return '••••';
  return '••••' + key.slice(-4);
}
