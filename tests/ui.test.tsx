// @vitest-environment happy-dom
// Phase 1 checks: tap through owner and teammate journeys, empty/error states,
// typed text and tab position surviving Back, every button leading somewhere
// or saying it is unavailable. Mock data and test identities only.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { App } from '../src/ui/App';
import { Api } from '../src/server/api';
import { DirectClient } from '../src/ui/client';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  localStorage.clear();
  location.hash = '';
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(React.createElement(App, { client: new DirectClient(new Api()) })); });
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
const clickCardButton = async (cardLabel: string, buttonLabel: string) => {
  act(() => {
    const card = [...document.querySelectorAll('div.card')].find((c) => (c.textContent ?? '').includes(cardLabel));
    if (!card) throw new Error('card not found: ' + cardLabel);
    const b = [...card.querySelectorAll('button')].find((x) => (x.textContent ?? '').trim() === buttonLabel);
    if (!b) throw new Error('button not found in card ' + cardLabel + ': ' + buttonLabel);
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
};
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
const activeTab = () => [...document.querySelectorAll('[role="tab"]')].find((t) => t.getAttribute('aria-selected') === 'true')?.textContent?.trim();
const clickTab = async (name: string) => {
  act(() => {
    const t = [...document.querySelectorAll('[role="tab"]')].find((x) => x.textContent?.trim() === name)!;
    t.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
};

async function createProjectJourney(name = 'Roadmap App') {
  await click('Create project');
  setVal(field('Project name'), name);
  setVal(field('Master prompt or PRD'), 'Build a small roadmap app with milestones and owners.');
  setVal(field('Agent instructions'), 'Keep code simple.');
  await click('Create'); // -> invite screen
  expect(text()).toContain('Team code');
  const code = document.querySelector('.code')!.textContent!.trim();
  await click('Choose AI model'); // -> ai access
  await click('Continue'); // owner model -> workspace
  expect(document.querySelector('.topbar .title')!.textContent).toBe(name);
  return code;
}

describe('Phase 1 owner journey and states', () => {
  it('register, empty project list, create errors, full create flow, workspace empty states', async () => {
    // welcome: register a name (validation error first)
    await click('Continue');
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('2 characters');
    setVal(field('Your name'), 'Asha');
    await click('Continue'); // -> home
    expect(text()).toContain('Hi, Asha');
    expect(text()).toContain('No projects yet.'); // empty state

    // create with too-short name -> error, then fix
    await click('Create project');
    setVal(field('Project name'), 'R');
    await click('Create');
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('name');
    await click('Back'); // back to home, then real create
    const code = await createProjectJourney();
    expect(code.length).toBeGreaterThan(3);

    // workspace empty states on every tab
    expect(text()).toContain('Waiting for teammates'); // assign says unavailable
    expect((btn('Waiting for teammates') as HTMLButtonElement).disabled).toBe(true);
    await clickTab('Tasks');
    expect(text()).toContain('No tasks yet.');
    await clickTab('Code'); // root files exist from create; owner can edit
    expect(text()).toContain('PRD.md');
    expect(text()).toContain('editable');
    await clickTab('Preview');
    expect(text()).toContain('Nothing to preview yet.');
    await clickTab('Chat');
    expect(activeTab()).toBe('Chat');
  });

  it('tab position and typed composer text survive Back (bugs 5 and 6)', async () => {
    await click('Ram'); // seeded owner of Habit Tracker
    // Habit Tracker has ai set, card goes straight to workspace
    await clickCard('Habit Tracker');
    expect(activeTab()).toBe('Chat');
    await clickTab('Code');
    await click('Back'); // -> home
    await clickCard('Habit Tracker');
    expect(activeTab()).toBe('Code'); // bug 5: tab memory

    await clickTab('Chat');
    const composer = document.querySelector('.composer textarea') as HTMLTextAreaElement;
    setVal(composer, 'draft one');
    await click('Back');
    await clickCard('Habit Tracker');
    expect(activeTab()).toBe('Chat');
    expect((document.querySelector('.composer textarea') as HTMLTextAreaElement).value).toBe('draft one'); // bug 6: draft memory
    setVal(document.querySelector('.composer textarea') as HTMLTextAreaElement, '');
  });

  it('simulated build error shows a Retry that works; team and skills sheets open and close', async () => {
    await click('Seeta'); // teammate with an assigned task in seed after assign; assign first as Ram
    await click('Switch');
    await click('Ram');
    await clickCard('Habit Tracker');
    await click('Assign tasks (simulated)');
    await click('Back');
    await click('Switch');
    await click('Seeta');
    await clickCard('Habit Tracker'); // teammate with ai set -> workspace
    await click('Simulate error');
    expect(text()).toContain('Retry');
    await click('Retry');
    expect(text()).not.toContain('simulated AI error');

    await click('Team');
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    await click('Close');
    await click('Back');
    await click('Switch');
    await click('Ram');
    await clickCard('Habit Tracker'); // owner workspace
    await click('Add');
    expect(text()).toContain('Starter catalog.');
    setVal(document.querySelector('[aria-label="Search catalog"]') as HTMLInputElement, 'zzz-no-match');
    expect(text()).toContain('Nothing matches');
    setVal(document.querySelector('[aria-label="Search catalog"]') as HTMLInputElement, '');
    // Owner adds Local shared-name check (approved at once) and runs it on PRD.md through the UI.
    await clickCardButton('Local shared-name check', 'Add');
    expect(text()).toContain('approved');
    setVal(document.querySelector('[aria-label="File for Local shared-name check"]') as HTMLInputElement, 'PRD.md');
    await click('Run');
    expect(text()).toContain('Review of PRD.md');
    await click('Close');
  });

  it('teammate-added skill waits for owner approval and shows no run control', async () => {
    await click('Seeta');
    await clickCard('Habit Tracker');
    await click('Add');
    expect(text()).toContain('Starter catalog.');
    await clickCardButton('Local shared-name check', 'Add');
    expect(text()).toContain('waiting for owner');
    // No run control while unapproved.
    expect(document.querySelector('[aria-label="File for Local shared-name check"]')).toBeNull();
    await click('Close');
  });
});

describe('Phase 3 preview checks (simulated)', () => {
  const rerenderWithHash = async (hash: string) => {
    act(() => root.unmount());
    host.remove();
    location.hash = hash;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root.render(React.createElement(App, { client: new DirectClient(new Api()) })); });
    await flush();
  };

  it('edited code is what the preview shows, and the preview iframe is sandboxed', async () => {
    await rerenderWithHash('#demo=seeta'); // teammate with a built frontend/index.html
    await clickTab('Code');
    const editor = document.querySelector('textarea.editor') as HTMLTextAreaElement;
    expect(editor.value.length).toBeGreaterThan(0);
    setVal(editor, editor.value + '\n<p>EDITED-MARKER-123</p>');
    await click('Save');
    await clickTab('Preview');
    const frame = document.querySelector('iframe[title="Preview"]') as HTMLIFrameElement;
    expect(frame).toBeTruthy();
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts'); // scripts only, no same-origin, no app data
    expect(frame.getAttribute('srcdoc')).toContain('EDITED-MARKER-123');
  });

  it('teammate preview lists only files they can read', async () => {
    await rerenderWithHash('#demo=seeta');
    await clickTab('Preview');
    expect(text()).toContain('frontend/index.html');
    expect(text()).not.toContain('Simulated preview of CONTRACT');
  });
});

describe('Phase 1 teammate journey and restrictions', () => {
  it('join error with wrong code, join with real code, teammate-only views', async () => {
    const code = await (async () => { await click('Ram'); await createProjectJourney('Capsule'); await click('Team'); const t = document.querySelector('.sheet .code')!.textContent!.trim(); await click('Close'); return t; })();
    await click('Back'); // workspace -> home
    await click('Switch');
    await click('Seeta');
    await click('Join project');
    setVal(field('Team code'), 'BAD-000');
    await click('frontend');
    await click('Join');
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('No project has that code');
    setVal(field('Team code'), code);
    await click('Join'); // -> ai access
    await click('Continue'); // owner model -> workspace
    // teammate restrictions and empty states
    expect(text()).toContain('teammate');
    expect(text()).toContain('You have no task yet.');
    await clickTab('Tasks');
    expect(text()).toContain('You see only your own tasks.');
    expect(text()).toContain('No tasks yet.');
    await clickTab('Code'); // teammate reads root files but cannot write them
    expect(text()).toContain('read only');
    expect(text()).toContain('Only the owner can change it.');
    await clickTab('Preview');
    expect(text()).toContain('Nothing to preview yet.');
  });
});
