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
import { keyring } from '../src/core/providers';

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
    await click('Approve plan');
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
    expect(text()).toContain('Starter catalog: the named tools mapped to what they really are.');
    // the note is derived from the catalog: every locally runnable item is named, and it never claims the rest "cannot run yet"
    expect(text()).toContain('Local secret scan, Local shared-name check, Docs outline run locally');
    expect(text()).not.toContain('The rest are listed but cannot run yet');
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
    expect(text()).toContain('Starter catalog: the named tools mapped to what they really are.');
    await clickCardButton('Local shared-name check', 'Add');
    expect(text()).toContain('waiting for owner');
    // No run control while unapproved.
    expect(document.querySelector('[aria-label="File for Local shared-name check"]')).toBeNull();
    await click('Close');
  });
});

describe('Phase 3 preview checks (web runtime)', () => {
  const rerenderWithHash = async (hash: string) => {
    act(() => root.unmount());
    host.remove();
    location.hash = hash;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    api = new Api();
  await act(async () => { root.render(React.createElement(App, { client: new DirectClient(api) })); });
    await flush();
  };

  it('edited code is what the preview shows, and the preview iframe is sandboxed', async () => {
    await rerenderWithHash('#demo=seeta'); // teammate with a built home/index.html
    await clickTab('Code');
    await click('home/index.html');
    const editor = document.querySelector('textarea.editor') as HTMLTextAreaElement;
    expect(editor.value.length).toBeGreaterThan(0);
    setVal(editor, editor.value + '\n<p>EDITED-MARKER-123</p>');
    await click('Save');
    await clickTab('Preview');
    const frame = document.querySelector('iframe[title="Preview"]') as HTMLIFrameElement;
    expect(frame).toBeTruthy();
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts'); // scripts only, no same-origin, no app data
    expect(frame.getAttribute('srcdoc')).toContain('EDITED-MARKER-123');
    // Full-stack preview: the shim is injected ahead of the page, and the feature's api.ts
    // runs in a second hidden sandbox iframe.
    expect(frame.getAttribute('srcdoc')).toContain('__cc');
    const be = document.querySelector('iframe[title="Backend runtime"]') as HTMLIFrameElement;
    expect(be).toBeTruthy();
    expect(be.getAttribute('sandbox')).toBe('allow-scripts');
    expect(be.getAttribute('srcdoc')).toContain('export async function handle');
  });

  it('teammate preview lists only files they can read', async () => {
    await rerenderWithHash('#demo=seeta');
    await clickTab('Preview');
    expect(text()).toContain('home/index.html');
    expect(text()).not.toContain('Preview of CONTRACT');
  });

  it('teammate creates a new file inside their folder from the Code tab; outside-folder and existing paths are refused', async () => {
    await rerenderWithHash('#demo=seeta'); // teammate with a built home/index.html
    await clickTab('Code');
    await click('New file');
    const input = document.querySelector('input[aria-label="New file path"]') as HTMLInputElement;
    expect(input.value).toBe('home/'); // prefilled with the teammate's folder
    setVal(input, 'outside/sneaky.ts');
    await click('Create');
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('inside your folder');
    setVal(input, 'home/../settings/x.ts');
    await click('Create');
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('plain relative path');
    setVal(input, 'home/index.html');
    await click('Create');
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('already exists');
    setVal(input, 'home/styles.css');
    await click('Create');
    await flush();
    expect(document.querySelector('[role="alert"]')).toBeNull();
    // the new file opens in the editor and is listed
    expect(text()).toContain('home/styles.css');
    const editor = document.querySelector('textarea.editor') as HTMLTextAreaElement;
    expect(editor.readOnly).toBe(false);
    setVal(editor, 'body { margin: 0; }');
    await click('Save');
    await flush();
    expect(text()).not.toContain('Unsaved changes');
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

describe('Phase 8 UI: conflict review and owner backup', () => {
  it('a conflicting save shows both versions and never overwrites silently', async () => {
    await click('Ram');
    await clickCard('Habit Tracker');
    await clickTab('Code');
    await click('PRD.md');
    const ed = document.querySelector('textarea.editor') as HTMLTextAreaElement;
    setVal(ed, '# my unsaved edit');
    // Another writer saves a newer revision through the same server state.
    const list = await api.call({ as: 'u-ram', op: 'listProjects' });
    if (!list.ok) throw Error();
    const pid = (list.data as any[])[0].id;
    const view = await api.call({ as: 'u-ram', op: 'getProject', args: { projectId: pid } });
    if (!view.ok) throw Error();
    const rev = (view.data as any).fileRevs['PRD.md'];
    const other = await api.call({ as: 'u-ram', op: 'saveFile', args: { projectId: pid, path: 'PRD.md', content: '# their saved version', baseRev: rev } });
    if (!other.ok) throw Error();
    await click('Save'); // our stale revision conflicts
    expect(text()).toContain('changed this file while you were editing');
    expect(text()).toContain('their saved version'); // their version is shown for review
    const still = await api.call({ as: 'u-ram', op: 'getProject', args: { projectId: pid } });
    if (!still.ok) throw Error();
    expect((still.data as any).files['PRD.md']).toBe('# their saved version'); // nothing overwritten
    await click('Keep my version');
    const after = await api.call({ as: 'u-ram', op: 'getProject', args: { projectId: pid } });
    if (!after.ok) throw Error();
    expect((after.data as any).files['PRD.md']).toBe('# my unsaved edit'); // explicit choice wins
    expect(text()).not.toContain('changed this file while you were editing');
  });

  it('owner sees Export and restore guidance; teammate does not', async () => {
    await click('Ram');
    await clickCard('Habit Tracker');
    await click('Team');
    expect(text()).toContain('Backup');
    expect(text()).toContain('conflict loudly');
    await click('Export');
    const ta = document.querySelector('textarea[aria-label="Backup JSON"]') as HTMLTextAreaElement;
    expect(ta.value).toContain('"format": "crewcode-backup"');
    await click('Close');
    await click('Back');
    await click('Switch');
    await click('Seeta');
    await clickCard('Habit Tracker');
    await click('Team');
    expect(text()).not.toContain('Backup');
  });

  it('owner sees the Drive backup section disabled without a confirmed client ID; teammate does not', async () => {
    await click('Ram');
    await clickCard('Habit Tracker');
    await click('Team');
    expect(text()).toContain('Google Drive backup');
    expect(text()).toContain('not connected');
    expect(text()).toContain('no confirmed Google OAuth client ID');
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Save backup to Google Drive') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(true);
    await click('Close');
    await click('Back');
    await click('Switch');
    await click('Seeta');
    await clickCard('Habit Tracker');
    await click('Team');
    expect(text()).not.toContain('Google Drive backup');
  });

  it('owner sees an expired team code and regenerating reopens joining', async () => {
    (api as any).state.projects[0].team.expiresAt = Date.now() - 1000; // force expiry
    await click('Ram');
    await clickCard('Habit Tracker');
    await click('Team');
    expect(text()).toContain('This code expired');
    expect(text()).toContain('Teammates cannot join with it');
    const before = document.querySelector('.sheet .code')!.textContent!.trim();
    await click('New code');
    expect(text()).not.toContain('This code expired');
    expect(text()).toContain('This code expires on');
    const after = document.querySelector('.sheet .code')!.textContent!.trim();
    expect(after).not.toBe(before);
  });

  it('owner configures expiry and join limit from the Team sheet', async () => {
    await click('Ram');
    await clickCard('Habit Tracker');
    await click('Team');
    // New codes start with the labeled test default window and no join limit.
    expect(text()).toContain('This code expires on');
    expect(text()).toContain('no limit');
    await click('No expiry');
    expect(text()).toContain('No expiry set.');
    await click('5');
    expect(text()).toContain('limit 5');
    await click('No limit');
    expect(text()).toContain('no limit');
    await click('7 days');
    expect(text()).toContain('This code expires on');
  });

  it('owner integration review flags contract mismatches per folder; teammate does not see it', async () => {
    const pid = (api.state as any).projects[0].id;
    await click('Ram');
    await clickCard('Habit Tracker');
    await clickTab('Tasks');
    expect(text()).toContain('No tasks yet');
    expect(text()).not.toContain('Integration review');
    await api.call({ as: 'u-ram', op: 'assignTasks', args: { projectId: pid } });
    await api.call({ as: 'u-ram', op: 'confirmPlanning', args: { projectId: pid, accept: true } });
    // Owner plants a mismatch in the teammate folder and the teammate submits the done task.
    await api.call({ as: 'u-ram', op: 'saveFile', args: { projectId: pid, path: 'home/index.html', content: '<p>@shared BOGUS_NAME</p>' } });
    const seetaTask = () => api.state.projects.find((x) => x.id === pid)!.tasks.find((t) => t.assigneeId === 'u-seeta')!;
    await api.call({ as: 'u-seeta', op: 'setTaskStatus', args: { projectId: pid, taskId: seetaTask().id, status: 'done' } });
    await api.call({ as: 'u-seeta', op: 'submitTaskForReview', args: { projectId: pid, taskId: seetaTask().id } });
    await click('Back');
    await clickCard('Habit Tracker');
    await clickTab('Tasks');
    expect(text()).toContain('Integration review');
    // Owner runs the check: the mismatch is reported and the merge stays blocked.
    await click('Run check');
    expect(text()).toContain('changes requested');
    expect(text()).toContain('BOGUS_NAME in home/index.html');
    const mergeBtn = btn('Merge into main') as HTMLButtonElement;
    expect(mergeBtn.disabled).toBe(true);
    // Fixing the file and re-running the check clears the flag and the merge goes through.
    await api.call({ as: 'u-ram', op: 'saveFile', args: { projectId: pid, path: 'home/index.html', content: '<p>@shared PROJECT_NAME</p>' } });
    await api.call({ as: 'u-seeta', op: 'submitTaskForReview', args: { projectId: pid, taskId: seetaTask().id } });
    await click('Back');
    await clickCard('Habit Tracker');
    await clickTab('Tasks');
    await click('Run check');
    expect(text()).not.toContain('BOGUS_NAME');
    await click('Merge into main');
    expect(text()).toContain('Merged into main/home/');
    // The accepted work now lives in the owner's main folder.
    await clickTab('Code');
    expect(text()).toContain('main/home/index.html');
    await clickTab('Tasks');
    // Teammates never see the owner review card.
    await click('Back');
    await click('Switch');
    await click('Seeta');
    await clickCard('Habit Tracker');
    await clickTab('Tasks');
    expect(text()).not.toContain('Integration review');
  });
});

describe('real AI flow (own key, stubbed fetch - no live call)', () => {
  it('an own-key build calls the provider from the client and lands unlabeled-simulated output', async () => {
    const pid = (api.state as any).projects[0].id;
    await api.call({ as: 'u-ram', op: 'assignTasks', args: { projectId: pid } });
    await api.call({ as: 'u-ram', op: 'confirmPlanning', args: { projectId: pid, accept: true } });
    await api.call({ as: 'u-seeta', op: 'setAiAccess', args: { projectId: pid, access: { kind: 'own', provider: 'Grok' } } });
    keyring.set('u-seeta', 'Grok', { key: 'TESTKEY-UI-1', endpointId: 'groq', model: 'test-model' });
    const realFetch = globalThis.fetch;
    let seen: any;
    (globalThis as any).fetch = async (u: any, i: any) => { seen = { u, i }; return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ message: 'Built the streak screen.', files: [{ path: 'home/index.html', content: '<h1>Real build</h1>' }] }) } }] }) }; };
    try {
      await click('Seeta');
      await clickCard('Habit Tracker');
      await click('Run build');
      await flush(); await flush(); await flush();
      expect(seen.u).toBe('https://api.groq.com/openai/v1/chat/completions');
      expect(seen.i.headers.authorization).toBe('Bearer TESTKEY-UI-1');
      expect(text()).toContain('Built the streak screen.');
      expect(text()).not.toContain('Simulated build. Built the streak screen.');
      expect(api.state.projects[0].files['home/index.html']).toBe('<h1>Real build</h1>');
    } finally { (globalThis as any).fetch = realFetch; keyring.clear(); }
  });
});

describe('Phase 9 states: drafts and unsaved edits survive a reload', () => {
  it('composer draft and unsaved code edit are kept locally across remount', async () => {
    await click('Ram');
    await clickCard('Habit Tracker');
    await clickTab('Chat');
    setVal(document.querySelector('.composer textarea') as HTMLTextAreaElement, 'offline draft');
    await clickTab('Code');
    await click('PRD.md');
    const ed = document.querySelector('textarea.editor') as HTMLTextAreaElement;
    setVal(ed, '# unsaved local edit');
    // Remount the whole app the way a reload would (same localStorage, same server state).
    act(() => root.unmount());
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root.render(React.createElement(App, { client: new DirectClient(api) })); });
    await flush();
    await clickCard('Habit Tracker');
    await clickTab('Chat');
    expect((document.querySelector('.composer textarea') as HTMLTextAreaElement).value).toBe('offline draft');
    await clickTab('Code');
    await click('PRD.md');
    expect((document.querySelector('textarea.editor') as HTMLTextAreaElement).value).toBe('# unsaved local edit');
    expect(text()).toContain('Unsaved changes');
  });

  it('a stale edit draft becomes an explicit conflict recovery, never silent loss', async () => {
    await click('Ram');
    await clickCard('Habit Tracker');
    await clickTab('Code');
    await click('PRD.md');
    setVal(document.querySelector('textarea.editor') as HTMLTextAreaElement, '# my kept draft');
    const list = await api.call({ as: 'u-ram', op: 'listProjects' });
    if (!list.ok) throw Error();
    const pid = (list.data as any[])[0].id;
    const view = await api.call({ as: 'u-ram', op: 'getProject', args: { projectId: pid } });
    if (!view.ok) throw Error();
    await api.call({ as: 'u-ram', op: 'saveFile', args: { projectId: pid, path: 'PRD.md', content: '# server moved on', baseRev: (view.data as any).fileRevs['PRD.md'] } });
    act(() => root.unmount());
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root.render(React.createElement(App, { client: new DirectClient(api) })); });
    await flush();
    await clickCard('Habit Tracker');
    await clickTab('Code');
    await click('PRD.md');
    // The draft is kept, the server version is shown, and the user chooses explicitly.
    expect((document.querySelector('textarea.editor') as HTMLTextAreaElement).value).toBe('# my kept draft');
    expect(text()).toContain('changed this file while you were editing');
    expect(text()).toContain('# server moved on');
    await click('Use their version');
    expect((document.querySelector('textarea.editor') as HTMLTextAreaElement).value).toBe('# server moved on');
    expect(text()).not.toContain('Unsaved changes');
    // and the stored draft is gone after the explicit choice
    act(() => root.unmount());
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root.render(React.createElement(App, { client: new DirectClient(api) })); });
    await flush();
    await clickCard('Habit Tracker');
    await clickTab('Code');
    await click('PRD.md');
    expect((document.querySelector('textarea.editor') as HTMLTextAreaElement).value).toBe('# server moved on');
  });

  it('an unresolved conflict survives file navigation until explicit resolution', async () => {
    await click('Ram');
    await clickCard('Habit Tracker');
    await clickTab('Code');
    await click('PRD.md');
    setVal(document.querySelector('textarea.editor') as HTMLTextAreaElement, '# my kept draft');
    const list = await api.call({ as: 'u-ram', op: 'listProjects' });
    if (!list.ok) throw Error();
    const pid = (list.data as any[])[0].id;
    const view = await api.call({ as: 'u-ram', op: 'getProject', args: { projectId: pid } });
    if (!view.ok) throw Error();
    await api.call({ as: 'u-ram', op: 'saveFile', args: { projectId: pid, path: 'PRD.md', content: '# server moved on', baseRev: (view.data as any).fileRevs['PRD.md'] } });
    act(() => root.unmount());
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root.render(React.createElement(App, { client: new DirectClient(api) })); });
    await flush();
    await clickCard('Habit Tracker');
    await clickTab('Code');
    await click('PRD.md');
    expect(text()).toContain('changed this file while you were editing');
    // Navigating to another file hides the panel but must not resolve or drop it.
    await click('CONTRACT.md');
    expect(text()).not.toContain('changed this file while you were editing');
    // Back on the conflicted file: the pending conflict and the draft are still there.
    await click('PRD.md');
    expect(text()).toContain('changed this file while you were editing');
    expect((document.querySelector('textarea.editor') as HTMLTextAreaElement).value).toBe('# my kept draft');
    // Only an explicit choice clears it.
    await click('Use their version');
    await click('CONTRACT.md');
    await click('PRD.md');
    expect(text()).not.toContain('changed this file while you were editing');
    expect((document.querySelector('textarea.editor') as HTMLTextAreaElement).value).toBe('# server moved on');
  });
});

describe('cross-session propagation (two open sessions)', () => {
  const scoped = (el: HTMLElement) => ({
    text: () => el.textContent ?? '',
    click: async (label: string) => {
      act(() => {
        const b = [...el.querySelectorAll('button')].find((x) => (x.textContent ?? '').trim() === label);
        if (!b) throw new Error('button not found: ' + label);
        b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await flush();
    },
    clickCard: async (label: string) => {
      act(() => {
        const b = [...el.querySelectorAll('button.card')].find((x) => (x.textContent ?? '').includes(label));
        if (!b) throw new Error('card not found: ' + label);
        b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await flush();
    },
    clickTab: async (name: string) => {
      act(() => {
        const t = [...el.querySelectorAll('[role="tab"]')].find((x) => x.textContent?.trim() === name)!;
        t.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await flush();
    },
  });
  const wait = async (ms: number) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };

  it('a teammate session sees the owner\'s save without a reload, and keeps her unsaved draft', async () => {
    // Remount session A with fast polling; A = Ram (owner).
    act(() => root.unmount()); host.remove();
    host = document.createElement('div'); document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root.render(React.createElement(App, { client: new DirectClient(api), pollMs: 50 })); });
    await flush();
    const A = scoped(host);
    await A.click('Ram');
    const pid = api.state.projects[0].id;
    await api.call({ as: 'u-ram', op: 'assignTasks', args: { projectId: pid } });
    await api.call({ as: 'u-ram', op: 'confirmPlanning', args: { projectId: pid, accept: true } });
    const tid = api.state.projects[0].tasks.find((t) => t.assigneeId === 'u-seeta')!.id;
    await api.call({ as: 'u-seeta', op: 'runBuild', args: { projectId: pid, taskId: tid } });

    // Session B in a second host; inherits stored identity Ram, then switches to Seeta.
    const hostB = document.createElement('div'); document.body.appendChild(hostB);
    const rootB = createRoot(hostB);
    await act(async () => { rootB.render(React.createElement(App, { client: new DirectClient(api), pollMs: 50 })); });
    await flush();
    const B = scoped(hostB);
    await B.click('Switch');
    await B.click('Seeta');
    await B.clickCard('Habit Tracker');
    await B.clickTab('Code');
    await B.click('home/index.html');
    // Seeta starts an unsaved edit in her file.
    const edB = () => hostB.querySelector('textarea.editor') as HTMLTextAreaElement;
    setVal(edB(), 'seeta unsaved draft');

    // Owner edits a different file (the contract) and saves.
    await A.clickCard('Habit Tracker');
    await A.clickTab('Code');
    await A.click('CONTRACT.md');
    const edA = () => host.querySelector('textarea.editor') as HTMLTextAreaElement;
    setVal(edA(), edA().value + '- NEW_SHARED_NAME\n');
    await A.click('Save');

    // Wait for at least one poll cycle; B reloaded silently in the background.
    await wait(400);
    // Her unsaved draft is untouched.
    expect(edB().value).toBe('seeta unsaved draft');
    // And the owner's save is visible in her session without any reload.
    await B.click('CONTRACT.md');
    expect(edB().value).toContain('NEW_SHARED_NAME');
    act(() => rootB.unmount()); hostB.remove();
  });
});

describe('owner plan gate (UI)', () => {
  it('assign proposes only; the owner reassigns a feature and approves; discard creates nothing', async () => {
    await click('Ram');
    await clickCard('Habit Tracker');
    const pid = api.state.projects[0].id;
    // Hanuma joins so the split has two teammates.
    await api.call({ as: 'u-hanuma', op: 'joinProject', args: { code: 'DEM-123', interests: ['backend'] } });
    await click('Assign tasks (simulated)');
    // Proposal card: tasks are not created yet.
    expect(api.state.projects[0].tasks).toHaveLength(0);
    expect(text()).toContain('Review the proposed split');
    // Swap both features: settings/ defaults to Hanuma, so both selects change (a plan
    // that leaves anyone taskless is rejected - that is the every-member rule working).
    for (const [folder, uid] of [['home/', 'u-hanuma'], ['settings/', 'u-seeta']] as const) {
      const sel = document.querySelector(`select[aria-label="Assign ${folder}"]`) as HTMLSelectElement;
      expect(sel).toBeTruthy();
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(sel, uid);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
    await click('Approve plan');
    const tasks = api.state.projects[0].tasks;
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.find((t) => t.folder === 'home/')!.assigneeId).toBe('u-hanuma');
    expect(tasks.find((t) => t.folder === 'settings/')!.assigneeId).toBe('u-seeta');
    expect(api.state.projects[0].messages.at(-1)!.text).toContain('Plan approved by the owner:');
    // Discard path: re-propose, then discard - tasks stay as approved.
    await api.call({ as: 'u-ram', op: 'assignTasks', args: { projectId: pid } });
    expect(api.state.projects[0].proposedPlan).toBeTruthy();
    await click('Back');
    await clickCard('Habit Tracker'); // reload picks up the new proposal
    await click('Discard');
    expect(api.state.projects[0].proposedPlan).toBeUndefined();
    expect(api.state.projects[0].tasks).toEqual(tasks);
  });
});
