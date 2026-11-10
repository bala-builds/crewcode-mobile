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

  it('nested folders with duplicate basenames stay distinguishable; dirty tabs survive close/reopen and navigation', async () => {
    await click('Ram');
    await clickCard('Habit Tracker');
    await clickTab('Code');
    const newFile = async (p: string) => {
      await click('New file');
      setVal(document.querySelector('input[aria-label="New file path"]') as HTMLInputElement, p);
      await click('Create');
      await flush();
    };
    await newFile('home/index.html');
    await newFile('settings/index.html');
    // both folders are collapsible groups in the explorer, each listing its own index.html
    const groups = [...document.querySelectorAll('.ftree details')].map((d) => d.querySelector('summary')!.textContent);
    expect(groups).toContain('home/');
    expect(groups).toContain('settings/');
    // open both files: tabs with the same basename show the full path instead
    const openFromTree = async (dir: string) => {
      const det = [...document.querySelectorAll('.ftree details')].find((d) => d.querySelector('summary')!.textContent === dir)!;
      act(() => { det.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      await flush();
    };
    await openFromTree('home/');
    await openFromTree('settings/');
    const tabTexts = [...document.querySelectorAll('.ftabs .ftab')].map((t) => (t.textContent ?? '').replace(/x$/, '').trim());
    expect(tabTexts).toContain('home/index.html');
    expect(tabTexts).toContain('settings/index.html');
    // dirty edit in settings/index.html survives close + reopen and a workspace-tab round trip
    const ed = document.querySelector('textarea.editor') as HTMLTextAreaElement;
    setVal(ed, '<p>dirty-settings</p>');
    expect(document.querySelector('.ftabs .ftab.on .fdot')).toBeTruthy();
    act(() => { (document.querySelector('.ftab.on .fx') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await flush();
    expect(document.querySelector('.ftabs')!.textContent).not.toContain('settings/index.html');
    await clickTab('Chat');
    await clickTab('Code');
    await openFromTree('settings/');
    expect((document.querySelector('textarea.editor') as HTMLTextAreaElement).value).toBe('<p>dirty-settings</p>');
    expect(document.querySelector('.ftabs .ftab.on .fdot')).toBeTruthy();
  });

  it('ctrl+number switches tabs but never steals keys while typing in the composer', async () => {
    await click('Ram');
    await clickCard('Habit Tracker');
    const composer = document.querySelector('.composer textarea') as HTMLTextAreaElement;
    setVal(composer, 'half-written');
    act(() => { composer.dispatchEvent(new KeyboardEvent('keydown', { key: '2', ctrlKey: true, bubbles: true })); });
    await flush();
    expect([...document.querySelectorAll('[role="tab"]')].find((t) => t.getAttribute('aria-selected') === 'true')?.textContent?.trim()).toBe('Chat');
    expect(composer.value).toBe('half-written');
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', ctrlKey: true, bubbles: true })); });
    await flush();
    expect([...document.querySelectorAll('[role="tab"]')].find((t) => t.getAttribute('aria-selected') === 'true')?.textContent?.trim()).toBe('Code');
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
    expect(document.querySelector('[role="dialog"][role="dialog"][aria-label="Notifications"]')).toBeTruthy();
    expect(text()).toContain('simulated build');
    // populated sheet links straight into the changed file, and has a visible Close control
    const sheetFile = [...document.querySelectorAll('[role="dialog"][aria-label="Notifications"] button')].find((b) => (b.textContent ?? '').includes('home/index.html'));
    expect(sheetFile).toBeTruthy();
    act(() => { [...document.querySelectorAll('[role="dialog"][aria-label="Notifications"] button')].find((b) => b.textContent?.trim() === 'Close')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await flush();
    expect(document.querySelector('[role="dialog"][role="dialog"][aria-label="Notifications"]')).toBeFalsy();
    // opening the sheet cleared the unread count
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

  it('teammate sees only their own thread events and files in alerts and history', async () => {
    // owner approves a plan (hanuma joins so the split has two teammates) and builds on seeta\'s thread only
    await click('Ram');
    await clickCard('Habit Tracker');
    const pidJ = api.state.projects[0].id;
    await api.call({ as: 'u-hanuma', op: 'joinProject', args: { code: 'DEM-123', interests: ['backend'] } });
    void pidJ;
    await click('Assign tasks (simulated)');
    await flush(); await flush();
    await click('Approve plan');
    await flush(); await flush();
    const pid = api.state.projects[0].id;
    const seetaTask = api.state.projects[0].tasks.find((t) => t.assigneeId === 'u-seeta')!;
    const otherTask = api.state.projects[0].tasks.find((t) => t.assigneeId !== 'u-seeta')!;
    expect(seetaTask).toBeTruthy();
    expect(otherTask).toBeTruthy();
    await api.call({ as: 'u-ram', op: 'runBuild', args: { projectId: pid, taskId: seetaTask.id, forceError: false, prompt: '' } });
    await api.call({ as: 'u-ram', op: 'runBuild', args: { projectId: pid, taskId: otherTask.id, forceError: false, prompt: '' } });
    await click('Back');
    // teammate view
    await click('Switch');
    await click('Seeta');
    await clickCard('Habit Tracker');
    const bell = [...document.querySelectorAll('.topbar button')].find((b) => (b.textContent ?? '').startsWith('Alerts'))!;
    act(() => { bell.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await flush();
    const sheetText = document.querySelector('[role="dialog"][aria-label="Notifications"]')!.textContent ?? '';
    expect(sheetText).toContain('simulated build');
    expect(sheetText).not.toContain(otherTask.title);
    const sheetFileButtons = [...document.querySelectorAll('[role="dialog"][aria-label="Notifications"] button')].map((b) => b.textContent ?? '').filter((t) => t.includes('/'));
    expect(sheetFileButtons.every((f) => f.startsWith(seetaTask.folder))).toBe(true);
    act(() => { (document.querySelector('.sheet-bg') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await flush();
    // code tab: explorer lists only files seeta can read; history shows only her build
    await clickTab('Code');
    expect(document.querySelector('.ftree')!.textContent).toContain(seetaTask.folder);
    expect(document.querySelector('.ftree')!.textContent).not.toContain(otherTask.folder);
    const summary = [...document.querySelectorAll('.changes summary')][0] as HTMLElement;
    expect(summary.textContent).toContain('Change history (1)');
    act(() => { summary.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await flush();
    const histText = document.querySelector('.changes')!.textContent ?? '';
    expect(histText).toContain('simulated build');
    expect(histText).not.toContain(otherTask.folder);
  });
});
