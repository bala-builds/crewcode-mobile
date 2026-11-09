import React, { useEffect, useMemo, useState } from 'react';
import type { AppState, Project, ProviderLabel } from '../core/types';
import { PROVIDER_LABELS } from '../core/types';
import * as S from '../core/store';
import { canAccess, visibleTasks, visibleMessages, visibleFiles, visibleMembers, isOwner } from '../core/permissions';
import { PROVIDERS, keyring, maskKey } from '../core/providers';
import { searchCatalog, CATALOG } from '../core/skills';
import { integrationCheck } from '../core/contract';

type Screen =
  | { name: 'welcome' } | { name: 'home' } | { name: 'create' } | { name: 'invite'; pid: string }
  | { name: 'join' } | { name: 'ai'; pid: string } | { name: 'workspace'; pid: string };
type Tab = 'chat' | 'code' | 'preview' | 'tasks';

const hashParams = () => new URLSearchParams(location.hash.slice(1));
// Screenshot/test helper: #demo=ram|seeta&tab=code. Seeded test identities only, never saved.
function demoStart(): { state: AppState; screen: Screen } | null {
  const who = hashParams().get('demo'); if (!who) return null;
  let st = S.seedState(); const pid = st.projects[0].id;
  const a = S.assignTasks(st, pid, 'u-ram'); if (a.ok) st = a.state;
  const t = st.projects[0].tasks[0];
  if (t) { const b = S.runBuild(st, pid, 'u-seeta', t.id, {}); if (b.ok) st = b.state; }
  st = S.signInAsTestUser(st, who === 'seeta' ? 'u-seeta' : 'u-ram');
  return { state: st, screen: { name: 'workspace', pid } };
}

const tabMemory = new Map<string, Tab>(); // tab position survives leaving and returning to a project
const draftMemory = new Map<string, string>(); // composer text survives going back and returning
const INTERESTS = ['frontend', 'backend', 'AI features', 'testing'];

export function App() {
  const demo = useMemo(() => demoStart(), []);
  const [state, setState] = useState<AppState>(() => demo?.state ?? { ...S.load(), currentUserId: null });
  const [screen, setScreen] = useState<Screen>(demo?.screen ?? { name: 'welcome' });
  useEffect(() => { S.save(state); }, [state]);
  const user = state.users.find((u) => u.id === state.currentUserId) ?? null;
  const go = (s: Screen) => setScreen(s);
  const nameOf = (id: string) => (id === 'ai' ? 'AI' : state.users.find((u) => u.id === id)?.name ?? 'Unknown');

  return (
    <div className="app">
      <div className="banner">Test identities only. Not a login. Real sign-in is built last. AI and previews are simulated.</div>
      {screen.name === 'welcome' && <Welcome state={state} setState={setState} go={go} />}
      {user && screen.name === 'home' && <Home state={state} user={user.id} go={go} signOut={() => { setState({ ...state, currentUserId: null }); go({ name: 'welcome' }); }} />}
      {user && screen.name === 'create' && <Create state={state} setState={setState} user={user.id} go={go} />}
      {user && screen.name === 'invite' && <Invite project={state.projects.find((p) => p.id === screen.pid)} go={go} />}
      {user && screen.name === 'join' && <Join state={state} setState={setState} user={user.id} go={go} />}
      {user && screen.name === 'ai' && <AiAccess state={state} setState={setState} user={user.id} pid={screen.pid} go={go} />}
      {user && screen.name === 'workspace' && <Workspace state={state} setState={setState} user={user.id} pid={screen.pid} go={go} nameOf={nameOf} />}
    </div>
  );
}

function Err({ text }: { text: string | null }) { return text ? <div className="err" role="alert">{text}</div> : null; }

function Welcome({ state, setState, go }: { state: AppState; setState: (s: AppState) => void; go: (s: Screen) => void }) {
  const [name, setName] = useState(''); const [err, setErr] = useState<string | null>(null);
  return (
    <div className="screen">
      <h1>CrewCode</h1>
      <p className="muted">Build software with your team in a chat. The owner's AI splits the work. Each person sees only their part.</p>
      <h2>Pick a test identity</h2>
      <div className="row wrap">
        {state.users.map((u) => (
          <button key={u.id} className="chip" onClick={() => { setState(S.signInAsTestUser(state, u.id)); go({ name: 'home' }); }}>{u.name}</button>
        ))}
      </div>
      <h2>Or register a name</h2>
      <label htmlFor="nm">Your name</label>
      <input id="nm" value={name} onChange={(e) => { setName(e.target.value); setErr(null); }} placeholder="e.g. Asha" autoComplete="off" />
      <Err text={err} />
      <button className="primary block" style={{ marginTop: 12 }} onClick={() => { const r = S.registerName(state, name); if (!r.ok) setErr(r.error); else { setState(r.state); go({ name: 'home' }); } }}>Continue</button>
    </div>
  );
}

function Home({ state, user, go, signOut }: { state: AppState; user: string; go: (s: Screen) => void; signOut: () => void }) {
  const mine = state.projects.filter((p) => p.members.some((m) => m.userId === user));
  const me = state.users.find((u) => u.id === user)!;
  return (
    <>
      <div className="topbar"><div className="title">Hi, {me.name}</div><button className="small" onClick={signOut}>Switch</button></div>
      <div className="screen">
        <div className="row"><button className="primary grow" onClick={() => go({ name: 'create' })}>Create project</button><button className="grow" onClick={() => go({ name: 'join' })}>Join project</button></div>
        <h2>Your projects</h2>
        {mine.length === 0 && <div className="empty">No projects yet. Create one, or join with a team code.</div>}
        {mine.map((p) => {
          const m = p.members.find((x) => x.userId === user)!; const last = visibleMessages(p, user).at(-1);
          return (
            <button key={p.id} className="card block" style={{ textAlign: 'left', display: 'block' }} onClick={() => go({ name: m.ai ? 'workspace' : 'ai', pid: p.id })}>
              <div className="row spread"><strong style={{ overflowWrap: 'anywhere' }}>{p.name}</strong><span className={'tag ' + m.role}>{m.role}</span></div>
              <div className="muted">{last ? last.text.slice(0, 80) : 'No activity yet'}</div>
            </button>
          );
        })}
      </div>
    </>
  );
}

function Create({ state, setState, user, go }: { state: AppState; setState: (s: AppState) => void; user: string; go: (s: Screen) => void }) {
  const [name, setName] = useState(''); const [prd, setPrd] = useState(''); const [ins, setIns] = useState(''); const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <div className="topbar"><button className="small" onClick={() => go({ name: 'home' })}>Back</button><div className="title">Create project</div></div>
      <div className="screen">
        <label htmlFor="pn">Project name</label><input id="pn" value={name} onChange={(e) => setName(e.target.value)} />
        <label htmlFor="prd">Master prompt or PRD</label>
        <textarea id="prd" value={prd} onChange={(e) => setPrd(e.target.value)} placeholder="Describe the app. Saved as PRD.md in the project root." />
        <label htmlFor="ins">Agent instructions</label>
        <textarea id="ins" value={ins} onChange={(e) => setIns(e.target.value)} placeholder="Rules for the AI. Saved as AGENT_INSTRUCTIONS.md in the project root." />
        <Err text={err} />
        <button className="primary block" style={{ marginTop: 12 }} onClick={() => { const r = S.createProject(state, user, name, prd, ins); if (!r.ok) setErr(r.error); else { setState(r.state); go({ name: 'invite', pid: r.projectId }); } }}>Create</button>
      </div>
    </>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return <button className="small" onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { setDone(false); } }}>{done ? 'Copied' : 'Copy'}</button>;
}

function Invite({ project, go }: { project?: Project; go: (s: Screen) => void }) {
  if (!project) return <div className="screen">Project not found.</div>;
  return (
    <div className="screen">
      <h1>Project created</h1>
      <p className="muted">PRD.md, AGENT_INSTRUCTIONS.md and CONTRACT.md were saved in the project root.</p>
      <div className="card"><div className="muted">Team code</div><div className="row spread"><div className="code">{project.team.code}</div><CopyBtn text={project.team.code} /></div></div>
      <p className="muted">Share this code. Teammates join, pick what they like to build, and the AI assigns their tasks.</p>
      <button className="primary block" onClick={() => go({ name: 'ai', pid: project.id })}>Choose AI model</button>
    </div>
  );
}

function Join({ state, setState, user, go }: { state: AppState; setState: (s: AppState) => void; user: string; go: (s: Screen) => void }) {
  const [code, setCode] = useState(''); const [picked, setPicked] = useState<string[]>([]); const [custom, setCustom] = useState(''); const [err, setErr] = useState<string | null>(null);
  const toggle = (i: string) => setPicked(picked.includes(i) ? picked.filter((x) => x !== i) : [...picked, i]);
  return (
    <>
      <div className="topbar"><button className="small" onClick={() => go({ name: 'home' })}>Back</button><div className="title">Join project</div></div>
      <div className="screen">
        <label htmlFor="tc">Team code</label><input id="tc" value={code} onChange={(e) => { setCode(e.target.value); setErr(null); }} placeholder="ABC-123" autoCapitalize="characters" />
        <h2>What do you like to build?</h2>
        <div className="row wrap">{INTERESTS.map((i) => <button key={i} className={'chip' + (picked.includes(i) ? ' on' : '')} aria-pressed={picked.includes(i)} onClick={() => toggle(i)}>{i}</button>)}</div>
        <label htmlFor="ci">Something else (optional)</label><input id="ci" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="e.g. login screen" />
        <Err text={err} />
        <button className="primary block" style={{ marginTop: 12 }} onClick={() => { const r = S.joinProject(state, user, code, [...picked, custom]); if (!r.ok) setErr(r.error); else { setState(r.state); go({ name: 'ai', pid: r.projectId }); } }}>Join</button>
      </div>
    </>
  );
}

function AiAccess({ state, setState, user, pid, go }: { state: AppState; setState: (s: AppState) => void; user: string; pid: string; go: (s: Screen) => void }) {
  const p = state.projects.find((x) => x.id === pid);
  const [kind, setKind] = useState<'owner' | 'own'>('owner'); const [prov, setProv] = useState<ProviderLabel | null>(null); const [key, setKey] = useState(''); const [err, setErr] = useState<string | null>(null);
  if (!p) return <div className="screen">Project not found.</div>;
  const owner = isOwner(p, user); const sharing = owner || p.ownerKeySharing;
  return (
    <div className="screen">
      <h1>Choose your AI</h1>
      <p className="muted">No real AI provider is connected in this build. Your choice is saved, answers are simulated.</p>
      <button className={'card block'} disabled={!sharing} aria-pressed={kind === 'owner'} onClick={() => setKind('owner')} style={{ textAlign: 'left', borderColor: kind === 'owner' ? 'var(--accent)' : undefined }}>
        <strong>{owner ? 'My model' : "Owner's AI model"}</strong>
        <div className="muted">{sharing ? (owner ? 'Uses the key you add as owner. Never shown to teammates.' : "Uses the owner's key. You will never see it.") : 'The owner turned this off.'}</div>
      </button>
      <button className="card block" aria-pressed={kind === 'own'} onClick={() => setKind('own')} style={{ textAlign: 'left', borderColor: kind === 'own' ? 'var(--accent)' : undefined }}>
        <strong>My own API key</strong><div className="muted">Kept in memory on this device only. Not saved.</div>
      </button>
      {kind === 'own' && <>
        <div className="row wrap">{PROVIDER_LABELS.map((l) => <button key={l} className={'chip' + (prov === l ? ' on' : '')} aria-pressed={prov === l} onClick={() => setProv(l)}>{l}</button>)}</div>
        {prov && <div className="note">{PROVIDERS.find((x) => x.label === prov)!.note}. These names are placeholders, not verified integrations.</div>}
        <label htmlFor="k">API key</label>
        <input id="k" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste a key" autoComplete="off" />
        {key && <p className="muted">Shown as {maskKey(key)}. Use a throwaway key. Nothing is sent anywhere.</p>}
      </>}
      <Err text={err} />
      <button className="primary block" style={{ marginTop: 12 }} onClick={() => {
        if (kind === 'own') { if (!prov) return setErr('Pick a provider.'); if (!key.trim()) return setErr('Paste a key, or choose the owner model.'); keyring.set(user, prov, key.trim()); }
        const r = S.setAiAccess(state, pid, user, kind === 'owner' ? { kind: 'owner' } : { kind: 'own', provider: prov! });
        if (!r.ok) setErr(r.error); else { setState(r.state); go({ name: 'workspace', pid }); }
      }}>Continue</button>
    </div>
  );
}

function Workspace({ state, setState, user, pid, go, nameOf }: { state: AppState; setState: (s: AppState) => void; user: string; pid: string; go: (s: Screen) => void; nameOf: (id: string) => string }) {
  const p = state.projects.find((x) => x.id === pid);
  const [tab, setTabState] = useState<Tab>((hashParams().get('tab') as Tab) || tabMemory.get(pid) || 'chat');
  const setTab = (t: Tab) => { tabMemory.set(pid, t); setTabState(t); };
  const [draft, setDraftState] = useState(() => draftMemory.get(pid) ?? '');
  const setDraft = (d: string) => { draftMemory.set(pid, d); setDraftState(d); };
  const [err, setErr] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | 'team' | 'skills'>((hashParams().get('sheet') as 'team' | 'skills') || null); const [q, setQ] = useState(''); const [open, setOpen] = useState<string | null>(null);
  const [thread, setThread] = useState<string | null>(null);
  if (!p) return <div className="screen">Project not found.</div>;
  const owner = isOwner(p, user);
  const tasks = visibleTasks(p, user);
  const activeThread = owner ? thread : (tasks[0]?.id ?? null);
  const act = (r: S.Result<any>) => { if (!r.ok) setErr(r.error); else { setErr(null); setState(r.state); } };
  const msgs = visibleMessages(p, user).filter((m) => (owner ? (activeThread ? m.taskId === activeThread : true) : true));

  return (
    <>
      <div className="topbar">
        <button className="small" onClick={() => go({ name: 'home' })}>Back</button>
        <div className="title">{p.name}</div>
        <span className={'tag ' + (owner ? 'owner' : '')}>{owner ? 'owner' : 'teammate'}</span>
        <button className="small" onClick={() => setSheet('team')}>Team</button>
      </div>
      <div className="search">
        <input aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search skills, MCPs, tools" onFocus={() => q === '' && undefined} />
        <button className="small" onClick={() => setSheet('skills')} aria-label="Add skills and MCPs">Add</button>
      </div>
      {tab === 'chat' && <ChatView p={p} user={user} nameOf={nameOf} msgs={msgs} tasks={tasks} owner={owner} thread={activeThread} setThread={setThread}
        onAssign={() => act(S.assignTasks(state, pid, user))} onBuild={(id: string, force: boolean) => act(S.runBuild(state, pid, user, id, { forceError: force }))} openCode={(f: string) => { setOpen(f); setTab('code'); }} err={err} />}
      {tab === 'code' && <CodeView p={p} user={user} open={open} setOpen={setOpen} onSave={(path, c, rev) => act(S.saveFile(state, pid, user, path, c, rev))} err={err} clearErr={() => setErr(null)} />}
      {tab === 'preview' && <PreviewView p={p} user={user} />}
      {tab === 'tasks' && <TasksView p={p} user={user} nameOf={nameOf} onStatus={(id, s) => act(S.setTaskStatus(state, pid, user, id, s))} err={err} />}
      {tab === 'chat' && (
        <div className="composer">
          <textarea aria-label="Message" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={owner || activeThread ? 'Message the AI' : 'No task assigned yet'} />
          <button className="primary" onClick={() => { const r = S.postPrompt(state, pid, user, draft, activeThread); if (r.ok) { setDraft(''); act(r); } else setErr(r.error); }}>Send</button>
        </div>
      )}
      <div className="tabs" role="tablist">
        {(['chat', 'code', 'preview', 'tasks'] as Tab[]).map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => { setTab(t); setErr(null); }}>{t[0].toUpperCase() + t.slice(1)}</button>)}
      </div>
      {sheet === 'team' && <TeamSheet state={state} p={p} user={user} nameOf={nameOf} act={act} close={() => setSheet(null)} err={err} />}
      {sheet === 'skills' && <SkillsSheet p={p} user={user} q={q} setQ={setQ} act={(r) => act(r)} state={state} pid={pid} close={() => setSheet(null)} err={err} />}
    </>
  );
}

function ChatView({ p, user, nameOf, msgs, tasks, owner, thread, setThread, onAssign, onBuild, openCode, err }: Record<string, any>) {
  const myTask = !owner ? tasks[0] : tasks.find((t: any) => t.id === thread);
  return (
    <div className="screen">
      {owner && tasks.length > 0 && (
        <div className="files">
          <button className={'chip small' + (thread === null ? ' on' : '')} onClick={() => setThread(null)}>Project</button>
          {tasks.map((t: any) => <button key={t.id} className={'chip small' + (thread === t.id ? ' on' : '')} onClick={() => setThread(t.id)}>{nameOf(t.assigneeId)}</button>)}
        </div>
      )}
      {!owner && myTask && <div className="card"><strong>{myTask.title}</strong><div className="muted">Folder: {myTask.folder}</div></div>}
      {!owner && !myTask && <div className="empty">You have no task yet. The owner's AI assigns tasks from the project prompt and your interests.</div>}
      {owner && p.tasks.length === 0 && (
        <div className="card"><strong>Ready to divide the work?</strong><p className="muted">The simulated AI reads PRD.md and assigns a folder to each teammate by interest.</p>
          <button className="primary" onClick={onAssign} disabled={p.members.length < 2}>{p.members.length < 2 ? 'Waiting for teammates' : 'Assign tasks (simulated)'}</button></div>
      )}
      <Err text={err} />
      <div className="chat">
        {msgs.length === 0 && myTask !== undefined && <div className="empty">No messages yet.</div>}
        {msgs.map((m: any) => {
          const mine = m.authorId === user; const ai = m.authorId === 'ai';
          return (
            <div key={m.id} className={'bubble ' + (mine ? 'me' : ai ? 'ai' : 'other') + (m.kind === 'ai_error' ? ' error' : '')}>
              {!mine && <div className="who">{nameOf(m.authorId)}{m.kind === 'ai_build' ? ' - simulated build' : ''}</div>}
              {m.text}
              {m.kind === 'ai_build' && m.files?.length > 0 && <div style={{ marginTop: 8 }}><button className="small" onClick={() => openCode(m.files[0])}>{'</>'} Code ({m.files.length})</button></div>}
              {m.kind === 'ai_error' && myTask && <div style={{ marginTop: 8 }}><button className="small" onClick={() => onBuild(myTask.id, false)}>Retry</button></div>}
            </div>
          );
        })}
      </div>
      {myTask && (
        <div className="row wrap" style={{ marginTop: 12 }}>
          <button onClick={() => onBuild(myTask.id, false)}>Run simulated build</button>
          <button onClick={() => onBuild(myTask.id, true)} aria-label="Simulate an error">Simulate error</button>
        </div>
      )}
    </div>
  );
}

function CodeView({ p, user, open, setOpen, onSave, err, clearErr }: { p: Project; user: string; open: string | null; setOpen: (f: string | null) => void; onSave: (path: string, c: string, rev: number) => void; err: string | null; clearErr: () => void }) {
  const files = visibleFiles(p, user); const path = open && files.includes(open) ? open : files.find((f) => canAccess(p, user, 'write', f)) ?? files[0] ?? null;
  const [text, setText] = useState(''); const [dirty, setDirty] = useState(false); const [rev, setRev] = useState(0);
  useEffect(() => { setText(path ? p.files[path] ?? '' : ''); setRev(path ? p.fileRevs?.[path] ?? 0 : 0); setDirty(false); }, [path, p.files]);
  if (!path) return <div className="screen"><div className="empty">No files you can open yet.</div></div>;
  const editable = canAccess(p, user, 'write', path);
  const t = visibleTasks(p, user);
  const findings = !isOwner(p, user) && t[0] ? integrationCheck(p.files['CONTRACT.md'], p.files, t[0].folder) : [];
  return (
    <div className="screen">
      <div className="files">{files.map((f) => <button key={f} className={'chip small' + (f === path ? ' on' : '')} onClick={() => { setOpen(f); clearErr(); }}>{f}</button>)}</div>
      <div className="row spread"><strong style={{ overflowWrap: 'anywhere' }}>{path}</strong><span className="tag">{editable ? 'editable' : 'read only'}</span></div>
      {!editable && <div className="note">You can read this file. Only the owner can change it.</div>}
      <textarea className="editor" aria-label={'Contents of ' + path} value={text} readOnly={!editable} onChange={(e) => { setText(e.target.value); setDirty(true); clearErr(); }} />
      <Err text={err} />
      {findings.length > 0 && <div className="note">Integration check: {findings.map((f) => `${f.name} in ${f.path} is not in CONTRACT.md`).join('. ')}</div>}
      <div className="row" style={{ marginTop: 8 }}><button className="primary" disabled={!editable || !dirty} onClick={() => onSave(path, text, rev)}>Save</button>{dirty && <span className="muted">Unsaved changes</span>}</div>
    </div>
  );
}

function PreviewView({ p, user }: { p: Project; user: string }) {
  const readable = visibleFiles(p, user).filter((f) => canAccess(p, user, 'read', f) && f.endsWith('index.html'));
  const [sel, setSel] = useState<string | null>(null); const path = sel && readable.includes(sel) ? sel : readable[0];
  if (!path) return <div className="screen"><div className="empty">Nothing to preview yet. Run a simulated build for a frontend task first.</div></div>;
  return (
    <div className="screen">
      <div className="note">Simulated preview of {path}. It runs in a sandbox with scripts only, no access to app data or keys.</div>
      {readable.length > 1 && <div className="files">{readable.map((f) => <button key={f} className={'chip small' + (f === path ? ' on' : '')} onClick={() => setSel(f)}>{f}</button>)}</div>}
      <iframe title="Preview" sandbox="allow-scripts" srcDoc={p.files[path]} />
    </div>
  );
}

function TasksView({ p, user, nameOf, onStatus, err }: { p: Project; user: string; nameOf: (id: string) => string; onStatus: (id: string, s: any) => void; err: string | null }) {
  const tasks = visibleTasks(p, user); const owner = isOwner(p, user);
  return (
    <div className="screen">
      {!owner && <div className="note">You see only your own tasks.</div>}
      <Err text={err} />
      {tasks.length === 0 && <div className="empty">No tasks yet.</div>}
      {tasks.map((t) => (
        <div key={t.id} className="card">
          <div className="row spread"><strong>{t.title}</strong><span className="tag">{t.status.replace('_', ' ')}</span></div>
          <p className="muted">{t.detail}</p>
          <div className="muted">Assigned to {nameOf(t.assigneeId)}. Folder {t.folder}</div>
          <div className="row wrap" style={{ marginTop: 8 }}>{(['todo', 'in_progress', 'done'] as const).map((s) => <button key={s} className={'chip small' + (t.status === s ? ' on' : '')} onClick={() => onStatus(t.id, s)}>{s.replace('_', ' ')}</button>)}</div>
        </div>
      ))}
    </div>
  );
}

function TeamSheet({ state, p, user, nameOf, act, close, err }: { state: AppState; p: Project; user: string; nameOf: (id: string) => string; act: (r: S.Result<any>) => void; close: () => void; err: string | null }) {
  const owner = isOwner(p, user); const members = visibleMembers(p, user);
  return (
    <div className="sheet-bg" onClick={close}><div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Team">
      <div className="row spread"><h2 style={{ margin: 0 }}>Team</h2><button className="small" onClick={close}>Close</button></div>
      <Err text={err} />
      {owner && <div className="card"><div className="muted">Team code{p.team.revoked ? ' (turned off)' : ''}</div><div className="row spread"><div className="code">{p.team.code}</div><CopyBtn text={p.team.code} /></div>
        <div className="row wrap" style={{ marginTop: 8 }}><button className="small" onClick={() => act(S.regenerateCode(state, p.id, user))}>New code</button><button className="small danger" onClick={() => act(S.revokeCode(state, p.id, user))} disabled={p.team.revoked}>Turn off</button></div></div>}
      {members.map((m) => (
        <div key={m.userId} className="card"><div className="row spread"><strong>{nameOf(m.userId)}</strong><span className={'tag ' + m.role}>{m.role}</span></div>
          <div className="muted">{m.interests.length ? m.interests.join(', ') : 'No interests listed'}</div>
          {owner && m.role !== 'owner' && <button className="small danger" style={{ marginTop: 8 }} onClick={() => act(S.removeMember(state, p.id, user, m.userId))}>Remove</button>}
        </div>
      ))}
      {owner && <div className="card"><div className="row spread"><div className="grow"><strong>Share my AI model</strong><div className="muted">Teammates can use it without seeing the key.</div></div>
        <button className={'chip' + (p.ownerKeySharing ? ' on' : '')} aria-pressed={p.ownerKeySharing} onClick={() => act(S.setOwnerKeySharing(state, p.id, user, !p.ownerKeySharing))}>{p.ownerKeySharing ? 'On' : 'Off'}</button></div></div>}
    </div></div>
  );
}

const RUNNABLE = new Set(['code-review', 'cloudflare-security']);

function SkillsSheet({ p, user, q, setQ, act, state, pid, close, err }: { p: Project; user: string; q: string; setQ: (s: string) => void; act: (r: S.Result<any>) => void; state: AppState; pid: string; close: () => void; err: string | null }) {
  const items = useMemo(() => searchCatalog(q), [q]); const owner = isOwner(p, user);
  const [runPath, setRunPath] = useState<Record<string, string>>({}); const [output, setOutput] = useState<string | null>(null);
  const run = (id: string) => {
    const r = S.runSkill(state, pid, user, id, (runPath[id] ?? '').trim());
    if (r.ok) { act(r); setOutput(r.output); }
    else act(r);
  };
  return (
    <div className="sheet-bg" onClick={close}><div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Skills and MCPs">
      <div className="row spread"><h2 style={{ margin: 0 }}>Skills, MCPs, prebuilt</h2><button className="small" onClick={close}>Close</button></div>
      <div className="note">Starter catalog. Local shared-name check and Local secret scan run locally, only inside your folder scope. The rest are listed but cannot run yet.</div>
      <input aria-label="Search catalog" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" />
      <Err text={err} />
      {output && <div className="note" role="status">{output}</div>}
      {items.length === 0 && <div className="empty">Nothing matches "{q}".</div>}
      {items.map((it) => {
        const added = p.skills.find((s) => s.id === it.id);
        return (
          <div key={it.id} className="card"><div className="row spread"><strong>{it.label}</strong><span className="tag">{it.kind}</span></div>
            <p className="muted">{it.summary}</p>
            <div className="muted">Permissions: {it.permissions.join('; ')}</div>
            <div className="row wrap" style={{ marginTop: 8 }}>
              {!added && <button className="small primary" onClick={() => act(S.addSkill(state, pid, user, it.id))}>Add</button>}
              {added && <span className="tag">{added.approvedByOwner ? 'approved' : 'waiting for owner'}</span>}
              {added && !added.approvedByOwner && owner && <button className="small" onClick={() => act(S.approveSkill(state, pid, user, it.id))}>Approve</button>}
              {added && (owner || added.addedBy === user) && <button className="small danger" onClick={() => { setOutput(null); act(S.removeSkill(state, pid, user, it.id)); }}>Remove</button>}
            </div>
            {added && added.approvedByOwner && RUNNABLE.has(it.id) && (
              <div className="row" style={{ marginTop: 8 }}>
                <input aria-label={`File for ${it.label}`} placeholder="file path, e.g. frontend/index.html" value={runPath[it.id] ?? ''} onChange={(e) => setRunPath({ ...runPath, [it.id]: e.target.value })} />
                <button className="small primary" onClick={() => run(it.id)}>Run</button>
              </div>
            )}
            {added && added.approvedByOwner && !RUNNABLE.has(it.id) && <div className="muted" style={{ marginTop: 8 }}>Cannot run yet in this build.</div>}
          </div>
        );
      })}
      <div className="muted">{CATALOG.length} items in the starter set.</div>
    </div></div>
  );
}
