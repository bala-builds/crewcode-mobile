/**
 * Key-leak scanner. Phase 5 check: no API response, error, log line or stored state
 * may contain anything shaped like a live provider key. Matches are returned masked.
 */
const KEY_PATTERNS: RegExp[] = [
  /\bgsk_[A-Za-z0-9_-]{16,}\b/g, // Groq
  /\bnv-[A-Za-z0-9_-]{16,}\b/g, // NVIDIA NIM
  /\bsk-[A-Za-z0-9_-]{16,}\b/g, // OpenAI-style
  /\bAIza[A-Za-z0-9_-]{20,}\b/g, // Google / Gemini
];

export function maskSecret(s: string): string {
  return s.length <= 6 ? '****' : s.slice(0, 3) + '****' + s.slice(-2);
}

/** Masked matches found in the text. Empty array means clean. */
export function scanForKeys(text: string): string[] {
  const found: string[] = [];
  for (const re of KEY_PATTERNS) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) found.push(maskSecret(m[0]));
  }
  return found;
}

export function hasKeyLike(text: string): boolean {
  return scanForKeys(text).length > 0;
}
