// @vitest-environment happy-dom
// Structured AI replies: the small markdown subset parser/renderer plus an
// end-to-end check that a simulated build reply renders as a real list,
// not a wall of text.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { parseBlocks, Structured } from '../src/ui/markdown';
import { App } from '../src/ui/App';
import { Api } from '../src/server/api';
import { DirectClient } from '../src/ui/client';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('parseBlocks', () => {
  it('parses headings, bullets, numbered lists, code fences and paragraphs', () => {
    const blocks = parseBlocks('## Summary\nDid the thing.\n\n- one\n- two\n\n1. first\n2. second\n\n```\nconst x = 1;\n- not a bullet\n```\n\nTrailing note.');
    expect(blocks[0]).toEqual({ type: 'heading', level: 2, text: 'Summary' });
    expect(blocks[1]).toEqual({ type: 'para', text: 'Did the thing.' });
    expect(blocks[2]).toEqual({ type: 'list', ordered: false, items: ['one', 'two'] });
    expect(blocks[3]).toEqual({ type: 'list', ordered: true, items: ['first', 'second'] });
    expect(blocks[4]).toEqual({ type: 'code', code: 'const x = 1;\n- not a bullet' });
    expect(blocks[5]).toEqual({ type: 'para', text: 'Trailing note.' });
  });
  it('keeps plain text as paragraphs (unformatted replies still read fine)', () => {
    expect(parseBlocks('just a sentence')).toEqual([{ type: 'para', text: 'just a sentence' }]);
  });
  it('treats an unclosed fence as code to the end', () => {
    expect(parseBlocks('```\ncode')).toEqual([{ type: 'code', code: 'code' }]);
  });
});

describe('Structured render', () => {
  let host: HTMLDivElement; let root: Root;
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
  afterEach(() => { act(() => root.unmount()); host.remove(); });
  const render = async (text: string) => { await act(async () => { root.render(React.createElement(Structured, { text })); }); };

  it('renders lists, headings and code as real elements', async () => {
    await render('## Title\n\n- a\n- b\n\n1. x\n2. y\n\n```\ncode line\n```');
    expect(host.querySelector('.md-h2')?.textContent).toBe('Title');
    expect(host.querySelectorAll('ul li').length).toBe(2);
    expect(host.querySelectorAll('ol li').length).toBe(2);
    expect(host.querySelector('pre.md-code code')?.textContent).toBe('code line');
  });
  it('renders inline bold and inline code', async () => {
    await render('Use **bold** and `home/api.ts` here.');
    expect(host.querySelector('strong')?.textContent).toBe('bold');
    expect(host.querySelector('code.md-ic')?.textContent).toBe('home/api.ts');
  });
});

describe('AI replies in chat render structured', () => {
  let host: HTMLDivElement; let root: Root; let api: Api;
  const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  const btn = (label: string) => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent ?? '').trim() === label);
    if (!b) throw new Error('button not found: ' + label);
    return b;
  };
  const click = async (label: string) => { act(() => { btn(label).dispatchEvent(new MouseEvent('click', { bubbles: true })); }); await flush(); };
  const clickCard = async (label: string) => {
    act(() => {
      const b = [...document.querySelectorAll('button.card')].find((x) => (x.textContent ?? '').includes(label));
      if (!b) throw new Error('card not found: ' + label);
      b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
  };

  beforeEach(async () => {
    localStorage.clear();
    location.hash = '';
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    api = new Api();
    await act(async () => { root.render(React.createElement(App, { client: new DirectClient(api) })); });
    await flush();
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  it('simulated build and plan replies render as structured lists, not walls of text', async () => {
    await click('Ram');
    await clickCard('Habit Tracker');
    await click('Assign tasks (simulated)');
    await flush(); await flush();
    await click('Approve plan');
    await flush(); await flush();
    // the approved-plan reply lists tasks as bullets
    const planBubble = [...document.querySelectorAll('.bubble.ai')].find((b) => (b.textContent ?? '').includes('Plan approved by the owner:'))!;
    expect(planBubble.querySelectorAll('ul li').length).toBeGreaterThan(0);
    await click('Build Home');
    await click('Run simulated build');
    await flush(); await flush(); await flush();
    const buildBubble = [...document.querySelectorAll('.bubble.ai')].find((b) => (b.textContent ?? '').includes('No live AI was called.'))!;
    expect(buildBubble).toBeTruthy();
    const items = [...buildBubble.querySelectorAll('ul li')].map((li) => li.textContent);
    expect(items).toEqual(['Wrote the feature page (index.html)', 'Wrote the API route (api.ts)']);
    // user's own messages stay plain text, never restructured
    const mine = [...document.querySelectorAll('.bubble.me')];
    for (const m of mine) expect(m.querySelector('.md')).toBeFalsy();
  });
});
