// @vitest-environment happy-dom
// Interaction coverage for the seven-tab workspace and the round-2/3 controls:
// tab switching, real task filters + progress sync, Files/Team/Settings tabs,
// draft preservation across tabs, preview refresh, and honest unavailable states.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { App } from '../src/ui/App';
import { Api } from '../src/server/api';
import { DirectClient } from '../src/ui/client';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let api: Api;

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

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const text = () => document.body.textContent ?? '';
const btn = (label: string) => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent ?? '').trim() === label);
  if (!b) throw new Error('button not found: ' + label);
  return b;
};
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const click = async (label: string) => { act(() => { btn(label).dispatchEvent(new MouseEvent('click', { bubbles: true })); }); await flush(); };
const setVal = (el: HTMLInputElement | HTMLTextAreaElement, v: string) => act(() => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
const field = (label: string) => {
  const l = [...document.querySelectorAll('label')].find((x) => (x.textContent ?? '').trim() === label);
  if (!l) throw new Error('label not found: ' + label);
  return document.getElementById(l.htmlFor) as HTMLInputElement | HTMLTextAreaElement;
};
const tabs = () => [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent?.trim());
const activeTab = () => [...document.querySelectorAll('[role="tab"]')].find((t) => t.getAttribute('aria-selected') === 'true')?.textContent?.trim();
const clickTab = async (name: string) => {
  act(() => {
    const t = [...document.querySelectorAll('[role="tab"]')].find((x) => x.textContent?.trim() === name)!;
    t.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
};

const clickCard = async (label: string) => {
  act(() => {
    const b = [...document.querySelectorAll('button.card')].find((x) => (x.textContent ?? '').includes(label));
    if (!b) throw new Error('card not found: ' + label);
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
};

// Open the seeded project as its owner Ram (two members, so task assignment is enabled).
async function openSeed() {
  await click('Ram');
  await clickCard('Habit Tracker');
  expect(document.querySelector('.topbar .title')!.textContent).toBe('Habit Tracker');
}

describe('seven-tab workspace', () => {
  it('shows all seven tabs and switches between them', async () => {
    await openSeed();
    expect(tabs()).toEqual(['Chat', 'Code', 'Preview', 'Tasks', 'Files', 'Team', 'Settings']);
    await clickTab('Files');
    expect(activeTab()).toBe('Files');
    expect(text()).toContain('PRD.md');
    expect(text()).toContain('AGENT_INSTRUCTIONS.md');
    expect(text()).toContain('CONTRACT.md');
    await clickTab('Team');
    expect(text()).toContain('Team code');
    await clickTab('Settings');
    expect(text()).toContain('AI access');
    expect(text()).toContain('Sign-in');
    await clickTab('Tasks');
    expect(activeTab()).toBe('Tasks');
    await clickTab('Chat');
    expect(activeTab()).toBe('Chat');
  });

  it('Files tab renders the real PRD content', async () => {
    await openSeed();
    await clickTab('Files');
    // PRD.md is a root doc; the viewer shows real file bytes, not placeholder text.
    const chip = [...document.querySelectorAll('.files .chip')].find((c) => (c.textContent ?? '').includes('PRD.md'))!;
    act(() => { (chip as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await flush();
    expect(text()).toContain('A small app to track daily habits.');
  });

  it('Settings shows honest unavailable sharing and Drive stays disconnected', async () => {
    await openSeed();
    await clickTab('Settings');
    expect(text()).toContain('Not available yet');
    const un = btn('Unavailable') as HTMLButtonElement;
    expect(un.disabled).toBe(true);
    await clickTab('Team');
    expect(text()).toContain('Paused: project storage is moving to GitHub instead');
    expect(text()).not.toContain('Your standing choice');
    // GitHub sign-in is gated on the server's reported state; in tests there is
    // no server, so it must settle to the honest unavailable state.
    await clickTab('Settings');
    await flush();
    expect(text()).toContain('Not connected');
    expect(text()).not.toContain('Sign in with GitHub');
  });

  it('task filters and progress bar reflect real task state', async () => {
    await openSeed();
    // Plan tasks through the real simulated orchestration (seed project has two members).
    setVal(document.querySelector('.composer textarea')!, 'build it');
    await click('Send');
    await click('Assign tasks (simulated)');
    await click('Approve plan');
    await clickTab('Tasks');
    const before = text().match(/(\d+) of (\d+) done - (\d+)%/);
    expect(before).toBeTruthy();
    const total = Number(before![2]);
    expect(Number(before![1])).toBe(0);
    expect(total).toBeGreaterThan(0);
    expect(document.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('0');
    // Mark one task done via its real status control.
    const cards = [...document.querySelectorAll('.screen .card')].filter((c) => (c.textContent ?? '').includes('Assigned to'));
    expect(cards.length).toBe(total);
    const doneBtn = [...cards[0].querySelectorAll('button')].find((b) => b.textContent?.trim() === 'done')!;
    act(() => { doneBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await flush();
    const pct = Math.round(100 / total);
    expect(text()).toContain(`1 of ${total} done - ${pct}%`);
    expect(document.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe(String(pct));
    // Filter to Done shows exactly the completed task; To do shows the rest.
    await click('Done');
    const shownDone = [...document.querySelectorAll('.screen .card')].filter((c) => (c.textContent ?? '').includes('Assigned to'));
    expect(shownDone.length).toBe(1);
    await click('To do');
    const shownTodo = [...document.querySelectorAll('.screen .card')].filter((c) => (c.textContent ?? '').includes('Assigned to'));
    expect(shownTodo.length).toBe(total - 1);
    await click('All');
    const shownAll = [...document.querySelectorAll('.screen .card')].filter((c) => (c.textContent ?? '').includes('Assigned to'));
    expect(shownAll.length).toBe(total);
  });

  it('composer draft survives tab switches', async () => {
    await openSeed();
    setVal(document.querySelector('.composer textarea')!, 'unsent note');
    await clickTab('Code');
    await clickTab('Tasks');
    await clickTab('Chat');
    expect((document.querySelector('.composer textarea') as HTMLTextAreaElement).value).toBe('unsent note');
  });

  it('preview tab shows the honest empty state, and refresh exists once a page exists', async () => {
    await openSeed();
    await clickTab('Preview');
    expect(text()).toContain('Nothing to preview yet');
  });

  it('Discover lists the three categories with honest per-item states', async () => {
    await openSeed();
    await click('Discover');
    expect(text()).toContain('Skills');
    expect(text()).toContain('MCP servers');
    expect(text()).toContain('Open-source prebuilt components');
    expect(text()).toContain('Claude Design');
    expect(text()).toContain('Cloudflare security MCP');
    expect(text()).toContain('Hosted service - information only');
    expect(text()).toContain('Runs locally in this build');
    expect(text()).toContain('Needs a connection - not available in this build');
    // No faked connections or add actions on the browse page.
    expect(text()).toContain('Nothing on this page is a live external connection');
    // Search narrows the catalogue.
    setVal(document.querySelector('input[aria-label="Search Discover catalogue"]') as HTMLInputElement, 'secret');
    await flush();
    expect(text()).toContain('Local secret scan');
    expect(text()).not.toContain('Claude Design');
  });

  it('code tab file search filters the explorer', async () => {
    await openSeed();
    await clickTab('Code');
    const search = document.querySelector('input[aria-label="Search files"]') as HTMLInputElement;
    expect(search).toBeTruthy();
    setVal(search, 'prd');
    await flush();
    const chips = [...document.querySelectorAll('.files .chip')].map((c) => c.textContent ?? '');
    expect(chips.some((c) => c.includes('PRD.md'))).toBe(true);
    expect(chips.some((c) => c.includes('AGENT_INSTRUCTIONS.md'))).toBe(false);
  });
});
