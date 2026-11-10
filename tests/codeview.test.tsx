// @vitest-environment happy-dom
// Code workspace brief checks: hierarchical explorer, open-file tabs with
// unsaved indicators, Ctrl+S save, change history from build records, and the
// notifications sheet fed by project activity.
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
  if (!b) throw new Error('button not found: ' + label + ' | have: ' + [...document.querySelectorAll('button')].map((x) => x.textContent?.trim()).join(', '));
  return b;
};
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const click = async (label: string) => { act(() => { btn(label).dispatchEvent(new MouseEvent('click', { bubbles: true })); }); await flush(); };
const clickCard = async (label: string) => {
  act(() => {
    const b = [...document.querySelectorAll('button.card')].find((x) => (x.textContent ?? '').includes(label));
    if (!b) throw new Error('card not found: ' + label);
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
};
const setVal = (el: HTMLInputElement | HTMLTextAreaElement, v: string) => act(() => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
const clickTab = async (name: string) => {
  act(() => {
    const t = [...document.querySelectorAll('[role="tab"]')].find((x) => x.textContent?.trim() === name)!;
    t.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
};

describe('code workspace brief: explorer, tabs, save shortcut, history, alerts', () => {
  it('hierarchical explorer groups folders, file tabs track dirty state, ctrl+s saves', async () => {
    await click('Ram');
    await clickCard('Habit Tracker');
    await clickTab('Code');
    // explorer is a tree with root docs and folder groups
    const tree = document.querySelector('.ftree[role="tree"]')!;
    expect(tree).toBeTruthy();
    expect(tree.textContent).toContain('PRD.md');
    // open CONTRACT.md from the explorer -> becomes an open tab
    const contractRow = [...tree.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('CONTRACT.md'))!;
    act(() => { contractRow.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await flush();
    const tabs = [...document.querySelectorAll('.ftabs .ftab')];
    expect(tabs.length).toBeGreaterThanOrEqual(2);
    expect(document.querySelector('.ftabs')!.textContent).toContain('CONTRACT.md');
    // type an edit -> dirty dot appears on the tab, ctrl+s saves it away
    const ed = document.querySelector('textarea.editor') as HTMLTextAreaElement;
    setVal(ed, '# changed contract\n');
    expect(document.querySelector('.ftabs .ftab.on .fdot')).toBeTruthy();
    act(() => { ed.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true })); });
    await flush(); await flush();
    expect(document.querySelector('.ftabs .ftab.on .fdot')).toBeFalsy();
    expect(api.state.projects[0].files['CONTRACT.md']).toBe('# changed contract\n');
    // closing the tab falls back to another open file
    act(() => { (document.querySelector('.ftab.on .fx') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await flush();
    expect([...document.querySelectorAll('.ftabs .ftab')].length).toBe(tabs.length - 1);
  });

  it('change history lists build file records and opens them; alerts sheet shows activity', async () => {
    await click('Ram');
    await clickCard('Habit Tracker');
    await click('Assign tasks (simulated)');
    await flush(); await flush();
    await click('Approve plan');
    await flush(); await flush();
    await click('Build Home');
    await click('Run simulated build');
    await flush(); await flush(); await flush();
    // a build ran -> unread alert on the bell, opens the notifications sheet
    const bell = [...document.querySelectorAll('.topbar button')].find((b) => (b.textContent ?? '').startsWith('Alerts'))!;
    expect(bell.textContent).toMatch(/\(\d/);
    act(() => { bell.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await flush();
    expect(document.querySelector('[role="dialog"][aria-label="Notifications"]')).toBeTruthy();
    expect(text()).toContain('simulated build');
    // opening the sheet clears the unread count
    act(() => { (document.querySelector('.sheet-bg') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await flush();
    expect([...document.querySelectorAll('.topbar button')].find((b) => (b.textContent ?? '').startsWith('Alerts'))!.textContent!.trim()).toBe('Alerts');
    // change history in the code tab lists the changed files and opens one
    await clickTab('Code');
    expect(text()).toContain('Change history');
    const summary = [...document.querySelectorAll('.changes summary')][0] as HTMLElement;
    act(() => { summary.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await flush();
    const histFile = [...document.querySelectorAll('.changes button')].find((b) => (b.textContent ?? '').includes('home/index.html'));
    expect(histFile).toBeTruthy();
    act(() => { histFile!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await flush();
    expect(document.querySelector('.ftabs')!.textContent).toContain('index.html');
  });
});
