import { describe, it, expect } from 'vitest';
import { highlight } from '../src/ui/highlight';

describe('highlight', () => {
  it('html tokens', () => {
    const toks = highlight('<html><body style="margin:0" id="api">Hi<!-- c --></body></html>', 'x/index.html');
    const byType = (t: string) => toks.filter((k) => k.t === t).map((k) => k.s);
    expect(byType('tag')).toContain('<body');
    expect(byType('attr')).toEqual(['style', 'id']);
    expect(byType('str')).toEqual(['"margin:0"', '"api"']);
    expect(byType('com')).toEqual(['<!-- c -->']);
    expect(toks.map((k) => k.s).join('')).toBe('<html><body style="margin:0" id="api">Hi<!-- c --></body></html>');
  });
  it('js tokens', () => {
    const toks = highlight("const a = 'x'; // hi\nlet n = 42;", 'a.ts');
    expect(toks.filter((k) => k.t === 'kw').map((k) => k.s)).toEqual(['const', 'let']);
    expect(toks.filter((k) => k.t === 'str')[0].s).toBe("'x'");
    expect(toks.filter((k) => k.t === 'com')[0].s).toBe('// hi');
    expect(toks.filter((k) => k.t === 'num')[0].s).toBe('42');
    expect(toks.map((k) => k.s).join('')).toBe("const a = 'x'; // hi\nlet n = 42;");
  });
  it('css tokens', () => {
    const toks = highlight('a { color: #fff; /* x */ margin: 10px; }', 'a.css');
    expect(toks.filter((k) => k.t === 'prop').map((k) => k.s)).toEqual(['color', 'margin']);
    expect(toks.filter((k) => k.t === 'num')[0].s).toBe('10px');
    expect(toks.map((k) => k.s).join('')).toBe('a { color: #fff; /* x */ margin: 10px; }');
  });
  it('plain for md', () => {
    expect(highlight('# Title', 'PRD.md')).toEqual([{ t: 'plain', s: '# Title' }]);
  });
});
