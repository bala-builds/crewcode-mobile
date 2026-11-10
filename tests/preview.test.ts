// In-app full-stack preview: the page gets a fetch shim, the feature backend runs in a
// second sandbox, and only plain-JS route modules are claimed to run (core/preview.ts).
import { describe, it, expect } from 'vitest';
import { buildPreviewDoc, buildBackendDoc, backendPathFor, FETCH_SHIM } from '../src/core/preview';

describe('full-stack preview documents', () => {
  it('the page doc starts with the fetch shim that intercepts /api only', () => {
    const doc = buildPreviewDoc('<html><body>hi</body></html>');
    expect(doc.startsWith(FETCH_SHIM)).toBe(true);
    expect(doc).toContain('/api');
    expect(doc).toContain('postMessage');
    expect(doc.endsWith('<html><body>hi</body></html>')).toBe(true);
  });

  it('the backend doc inlines the module and answers through handle(); a module without handle gets a 501 convention message', () => {
    const src = "export async function handle({ method, path }) { return { status: 200, body: { ok: true } }; }";
    const doc = buildBackendDoc(src);
    expect(doc).toContain(src);
    expect(doc).toContain('api-run');
    expect(doc).toContain('api-res');
    expect(doc).toContain('501');
  });

  it('the backend for a page is the api.ts next to it, feature folder or merged main copy', () => {
    expect(backendPathFor('home/index.html')).toBe('home/api.ts');
    expect(backendPathFor('main/home/index.html')).toBe('main/home/api.ts');
    expect(backendPathFor('index.html')).toBe('api.ts');
  });
});
