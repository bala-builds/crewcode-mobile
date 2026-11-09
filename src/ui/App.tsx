import React, { useEffect, useMemo, useState } from 'react';
import type { ProviderLabel, TaskStatus } from '../core/types';
import { PROVIDER_LABELS, ROOT_FILES } from '../core/types';
import { PROVIDERS, keyring, maskKey } from '../core/providers';
import { searchCatalog, CATALOG } from '../core/skills';
import { integrationCheck } from '../core/contract';
import { HttpClient, op, type ClientData, type ProjectView } from './client';

/**
 * The phone UI talks ONLY to the dev API through ClientData (HttpClient in production,
 * DirectClient in tests). It never sees other members' files, tasks or the team code:
 * the server sends each identity its redacted ProjectView. Test identities, no auth.
 */

type Screen =
  | { name: 'welcome' } | { name: 'home' } | { name: 'create' } | { name: 'invite'; pid: string }
  | { name: 'join' } | { name: 'ai'; pid: string } | { name: 'workspace'; pid: string };
type Tab = 'chat' | 'code' | 'preview' | 'tasks';
type Me = { id: string; name: string };
type UserInfo = { id: string; name: string };

const hashParams = () => new URLSearchParams(location.hash.slice(1));
const tabMemory = new Map<string, Tab>(); // tab position survives leaving and returning to a project
const draftMemory = new Map<string, string>(); // composer text survives going back and returning
const INTERESTS = ['frontend', 'backend', 'AI features', 'testing'];
const ME_KEY = 'crewcode-mobile-identity-v1';

const saveMe = (me: Me | null) => { try { me ? localStorage.setItem(ME_KEY, JSON.stringify(me)) : localStorage.removeItem(ME_KEY); } catch { /* ignore */ } };
const loadMe = (): Me | null => { try { const raw = localStorage.getItem(ME_KEY); if (raw) { const m = JSON.parse(raw); if (m && typeof m.id === 'string' && typeof m.name === 'string') return m; } } catch { /* ignore */ } return null; };

/** Write access derived from the redacted view: mirrors the server rule for the files the caller can see. */
function canWriteView(v: ProjectView, path: string): boolean {
  if (v.role === 'owner') return true;
  if ((ROOT_FILES as readonly string[]).includes(path)) return false;
  return v.tasks.some((t) => path.startsWith(t.folder));
}

export function App({ client }: { client?: ClientData }) {
  const cli = useMemo<ClientData>(() => client ?? new HttpClient('/api'), [client]);
  const [me, setMeState] = useState<Me | null>(() => (hashParams().get('demo') ? null : loadMe()));
  const setMe = (m: Me | null) => { saveMe(m); setMeState(m); };
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [projects, setProjects] = useState<ProjectView[]>([]);
  const [view, setView] = useState<ProjectView | null>(null);
  const [screen, setScreen] = useState<Screen>(hashParams().get('demo') ? { name: 'welcome' } : (loadMe() ? { name: 'home' } : { name: 'welcome' }));
  const [err, setErr] = useState<string | null>(null);
  const go = (s: Screen) => { setErr(null); setScreen(s); };

  // Screenshot/test helper: #demo=ram|seeta&tab=code. Seeds a planned, built project via the API.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const who = hashParams().get('demo');
      if (who) {
        const l = await op(cli, 'u-ram', 'listProjects');
        if (cancelled || !l.ok) return;
        const pid = l.data[0]?.id as string;
        let g = await op(cli, 'u-seeta', 'getProject', { projectId: pid });
        if (g.ok && g.data.tasks.length === 0) { await op(cli, 'u-ram', 'assignTasks', { projectId: pid }); g = await op(cli, 'u-seeta', 'getProject', { projectId: pid }); }
        if (g.ok && g.data.tasks[0] && !g.data.files['frontend/index.html']) await op(cli, 'u-seeta', 'runBuild', { projectId: pid, taskId: g.data.tasks[0].id });
        const me0: Me = who === 'seeta' ? { id: 'u-seeta', name: 'Seeta' } : { id: 'u-ram', name: 'Ram' };
        if (!cancelled) { setMe(me0); await refreshFor(me0.id, pid); go({ name: 'workspace', pid }); }
        return;
      }
      const u = await cli.call({ as: 'u-ram', op: 'listUsers' });
      if (!cancelled && u.ok) setUsers(u.data);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cli]);

  const refreshFor = async (userId: string, pid?: string | null) => {
    const l = await op(cli, userId, 'listProjects');
    if (l.ok) setProjects(l.data);
    if (pid) {
      const g = await op(cli, userId, 'getProject', { projectId: pid });
      if (g.ok) setView(g.data);
      return g.ok ? (g.data as ProjectView) : null;
    }
    return null;
  };

  const enterProject = async (pid: string) => {
    if (!me) return;
    const v = await refreshFor(me.id, pid);
    if (!v) { setErr('Project not found.'); return; }
    const mine = v.members.find((m) => m.userId === me.id);
    go(mine?.ai ? { name: 'workspace', pid } : { name: 'ai', pid });
  };

  const actOp = async (name: string, args: Record<string, unknown>, pid?: string) => {
    if (!me) return null;
    const r = await op(cli, me.id, name, args);
    if (!r.ok) { setErr(r.error); return null; }
    setErr(null);
    await refreshFor(me.id, pid ?? (screen.name === 'workspace' || screen.name === 'ai' || screen.name === 'invite' ? screen.pid : null));
    return r;
  };

  return (
    <div className="app">
      <div className="banner">Test identities only. Not a login. Real sign-in is built last. AI and previews are simulated.</div>
      {screen.name === 'welcome' && <Welcome users={users} pick={(u) => { setMe(u); go({ name: 'home' }); }}
        register={async (name) => {
          const r = await cli.call({ as: 'u-ram', op: 'registerName', args: { name } });
          if (!r.ok) return r.error;
          const u = await cli.call({ as: 'u-ram', op: 'listUsers' });
          if (u.ok) setUsers(u.data);
          setMe({ id: r.data.userId, name: name.trim() });
          go({ name: 'home' });
          return null;
        }} />}
      {me && screen.name === 'home' && <Home me={me} projects={projects} refresh={() => refreshFor(me.id)} go={go} enter={enterProject} signOut={() => { setMe(null); setView(null); go({ name: 'welcome' }); }} />}
      {me && screen.name === 'create' && <Create go={go} create={async (name, prd, ins) => {
        const r = await op(cli, me.id, 'createProject', { name, prd, instructions: ins });
        if (!r.ok) return r.error;
        await refreshFor(me.id);
        go({ name: 'invite', pid: r.data.projectId });
        return null;
      }} />}
      {me && screen.name === 'invite' && <InviteView view={view} pid={screen.pid} load={() => refreshFor(me.id, screen.pid)} go={go} />}
      {me && screen.name === 'join' && <Join go={go} join={async (code, interests) => {
        const r = await op(cli, me.id, 'joinProject', { code, interests });
        if (!r.ok) return r.error;
        await refreshFor(me.id, r.data.projectId);
        go({ name: 'ai', pid: r.data.projectId });
        return null;
      }} />}
      {me && screen.name === 'ai' && <AiAccess me={me} view={view} pid={screen.pid} load={() => refreshFor(me.id, screen.pid)} go={go}
        save={async (access) => {
          const r = await op(cli, me.id, 'setAiAccess', { projectId: screen.pid, access });
          if (!r.ok) return r.error;
          await refreshFor(me.id, screen.pid);
          go({ name: 'workspace', pid: screen.pid });
          return null;
        }} />}
      {me && screen.name === 'workspace' && <Workspace me={me} view={view} pid={screen.pid} load={() => refreshFor(me.id, screen.pid)} actOp={actOp} go={go} err={err} clearErr={() => setErr(null)} />}
    </div>
  );
}

function Err({ text }: { text: string | null }) { return text ? <div className="err" role="alert">{text}</div> : null; }

function Welcome({ users, pick, register }: { users: UserInfo[]; pick: (u: Me) => void; register: (name: string) => Promise<string | null> }) {
  const [name, setName] = useState(''); const [err, setErr] = useState<string | null>(null);
  return (
    <div className="screen">
      <h1>CrewCode</h1>
      <p className="muted">Build software with your team in a chat. The owner's AI splits the work. Each person sees only their part.</p>
      <h2>Pick a test identity</h2>
      <div className="row wrap">
        {users.map((u) => (
          <button key={u.id} className="chip" onClick={() => pick(u)}>{u.name}</button>
        ))}
      </div>
      <h2>Or register a name</h2>
      <label htmlFor="nm">Your name</label>
      <input id="nm" value={name} onChange={(e) => { setName(e.target.value); setErr(null); }} placeholder="e.g. Asha" autoComplete="off" />
      <Err text={err} />
      <button className="primary block" style={{ marginTop: 12 }} onClick={async () => setErr(await register(name))}>Continue</button>
    </div>
  );
}

function Home({ me, projects, refresh, go, enter, signOut }: { me: Me; projects: ProjectView[]; refresh: () => Promise<unknown>; go: (s: Screen) => void; enter: (pid: string) => Promise<void>; signOut: () => void }) {
  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="topbar"><div className="title">Hi, {me.name}</div><button className="small" onClick={signOut}>Switch</button></div>
      <div className="screen">
        <div className="row"><button className="primary grow" onClick={() => go({ name: 'create' })}>Create project</button><button className="grow" onClick={() => go({ name: 'join' })}>Join project</button></div>
        <h2>Your projects</h2>
        {projects.length === 0 && <div className="empty">No projects yet. Create one, or join with a team code.</div>}
        {projects.map((p) => {
          const m = p.members.find((x) => x.userId === me.id);
          if (!m) return null; // stale entry from a previous identity before the list refreshes
          const last = p.messages.at(-1);
          return (
            <button key={p.id} className="card block" style={{ textAlign: 'left', display: 'block' }} onClick={() => enter(p.id)}>
              <div className="row spread"><strong style={{ overflowWrap: 'anywhere' }}>{p.name}</strong><span className={'tag ' + m.role}>{m.role}</span></div>
              <div className="muted">{last ? last.text.slice(0, 80) : 'No activity yet'}</div>
            </button>
          );
        })}
      </div>
    </>
  );
}

function Create({ go, create }: { go: (s: Screen) => void; create: (name: string, prd: string, ins: string) => Promise<string | null> }) {
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
        <button className="primary block" style={{ marginTop: 12 }} onClick={async () => setErr(await create(name, prd, ins))}>Create</button>
      </div>
    </>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return <button className="small" onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { setDone(false); } }}>{done ? 'Copied' : 'Copy'}</button>;
}

function InviteView({ view, pid, load, go }: { view: ProjectView | null; pid: string; load: () => Promise<ProjectView | null>; go: (s: Screen) => void }) {
  const [v, setV] = useState<ProjectView | null>(view && view.id === pid ? view : null);
  useEffect(() => { if (!v) load().then((x) => setV(x)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!v) return <div className="screen">Loading...</div>;
  return (
    <div className="screen">
      <h1>Project created</h1>
      <p className="muted">PRD.md, AGENT_INSTRUCTIONS.md and CONTRACT.md were saved in the project root.</p>
      <div className="card"><div className="muted">Team code</div><div className="row spread"><div className="code">{v.teamCode}</div><CopyBtn text={v.teamCode ?? ''} /></div></div>
      <p className="muted">Share this code. Teammates join, pick what they like to build, and the AI assigns their tasks.</p>
      <button className="primary block" onClick={() => go({ name: 'ai', pid })}>Choose AI model</button>
    </div>
  );
}

function Join({ go, join }: { go: (s: Screen) => void; join: (code: string, interests: string[]) => Promise<string | null> }) {
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
        <button className="primary block" style={{ marginTop: 12 }} onClick={async () => setErr(await join(code, [...picked, custom]))}>Join</button>
      </div>
    </>
  );
}

function AiAccess({ me, view, pid, load, go, save }: { me: Me; view: ProjectView | null; pid: string; load: () => Promise<ProjectView | null>; go: (s: Screen) => void; save: (access: unknown) => Promise<string | null> }) {
  const [v, setV] = useState<ProjectView | null>(view && view.id === pid ? view : null);
  const [kind, setKind] = useState<'owner' | 'own'>('owner'); const [prov, setProv] = useState<ProviderLabel | null>(null); const [key, setKey] = useState(''); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (!v) load().then((x) => setV(x)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!v) return <div className="screen">Project not found.</div>;
  const owner = v.role === 'owner'; const sharing = owner || v.ownerKeySharing;
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
      <button className="primary block" style={{ marginTop: 12 }} onClick={async () => {
        if (kind === 'own') { if (!prov) return setErr('Pick a provider.'); if (!key.trim()) return setErr('Paste a key, or choose the owner model.'); keyring.set(me.id, prov, key.trim()); }
        setErr(await save(kind === 'owner' ? { kind: 'owner' } : { kind: 'own', provider: prov! }));
      }}>Continue</button>
    </div>
  );
}

function Workspace({ me, view, pid, load, actOp, go, err, clearErr }: { me: Me; view: ProjectView | null; pid: string; load: () => Promise<ProjectView | null>; actOp: (name: string, args: Record<string, unknown>, pid?: string) => Promise<any>; go: (s: Screen) => void; err: string | null; clearErr: () => void }) {
  const [tab, setTabState] = useState<Tab>((hashParams().get('tab') as Tab) || tabMemory.get(pid) || 'chat');
  const setTab = (t: Tab) => { tabMemory.set(pid, t); setTabState(t); };
  const [draft, setDraftState] = useState(() => draftMemory.get(pid) ?? '');
  const setDraft = (d: string) => { draftMemory.set(pid, d); setDraftState(d); };
  const [sheet, setSheet] = useState<null | 'team' | 'skills'>((hashParams().get('sheet') as 'team' | 'skills') || null); const [q, setQ] = useState(''); const [open, setOpen] = useState<string | null>(null);
  const [thread, setThread] = useState<string | null>(null);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const p = view && view.id === pid ? view : null;
  if (!p) return <div className="screen">Loading...</div>;
  const owner = p.role === 'owner';
  const nameOf = (id: string) => (id === 'ai' ? 'AI' : p.names[id] ?? 'Unknown');
  const tasks = p.tasks;
  const activeThread = owner ? thread : (tasks[0]?.id ?? null);
  const msgs = owner && activeThread ? p.messages.filter((m) => m.taskId === activeThread) : p.messages;

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
      {tab === 'chat' && <ChatView p={p} user={me.id} nameOf={nameOf} msgs={msgs} tasks={tasks} owner={owner} thread={activeThread} setThread={setThread}
        onAssign={() => actOp('assignTasks', { projectId: pid }, pid)} onBuild={(id: string, force: boolean) => actOp('runBuild', { projectId: pid, taskId: id, forceError: force }, pid)} openCode={(f: string) => { setOpen(f); setTab('code'); }} err={err} />}
      {tab === 'code' && <CodeView p={p} open={open} setOpen={setOpen} onSave={(path, c, rev) => actOp('saveFile', { projectId: pid, path, content: c, baseRev: rev }, pid)} err={err} clearErr={clearErr} />}
      {tab === 'preview' && <PreviewView p={p} />}
      {tab === 'tasks' && <TasksView p={p} nameOf={nameOf} onStatus={(id, s) => actOp('setTaskStatus', { projectId: pid, taskId: id, status: s }, pid)} err={err} />}
      {tab === 'chat' && (
        <div className="composer">
          <textarea aria-label="Message" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={owner || activeThread ? 'Message the AI' : 'No task assigned yet'} />
          <button className="primary" onClick={async () => { if (await actOp('postPrompt', { projectId: pid, text: draft, taskId: activeThread }, pid)) setDraft(''); }}>Send</button>
        </div>
      )}
      <div className="tabs" role="tablist">
        {(['chat', 'code', 'preview', 'tasks'] as Tab[]).map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => { setTab(t); clearErr(); }}>{t[0].toUpperCase() + t.slice(1)}</button>)}
      </div>
      {sheet === 'team' && <TeamSheet p={p} user={me.id} nameOf={nameOf} actOp={(n, a) => actOp(n, a, pid)} close={() => setSheet(null)} err={err} />}
      {sheet === 'skills' && <SkillsSheet p={p} user={me.id} q={q} setQ={setQ} actOp={(n, a) => actOp(n, a, pid)} pid={pid} close={() => setSheet(null)} err={err} />}
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

function CodeView({ p, open, setOpen, onSave, err, clearErr }: { p: ProjectView; open: string | null; setOpen: (f: string | null) => void; onSave: (path: string, c: string, rev: number) => void; err: string | null; clearErr: () => void }) {
  const files = Object.keys(p.files).sort();
  const path = open && files.includes(open) ? open : files.find((f) => canWriteView(p, f)) ?? files[0] ?? null;
  const [text, setText] = useState(''); const [dirty, setDirty] = useState(false); const [rev, setRev] = useState(0);
  useEffect(() => { setText(path ? p.files[path] ?? '' : ''); setRev(path ? p.fileRevs?.[path] ?? 0 : 0); setDirty(false); }, [path, p.files]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!path) return <div className="screen"><div className="empty">No files you can open yet.</div></div>;
  const editable = canWriteView(p, path);
  const t = p.tasks[0];
  const findings = p.role !== 'owner' && t ? integrationCheck(p.files['CONTRACT.md'], p.files, t.folder) : [];
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

function PreviewView({ p }: { p: ProjectView }) {
  const readable = Object.keys(p.files).filter((f) => f.endsWith('index.html')).sort();
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

function TasksView({ p, nameOf, onStatus, err }: { p: ProjectView; nameOf: (id: string) => string; onStatus: (id: string, s: TaskStatus) => void; err: string | null }) {
  return (
    <div className="screen">
      {p.role !== 'owner' && <div className="note">You see only your own tasks.</div>}
      <Err text={err} />
      {p.tasks.length === 0 && <div className="empty">No tasks yet.</div>}
      {p.tasks.map((t) => (
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

function TeamSheet({ p, user, nameOf, actOp, close, err }: { p: ProjectView; user: string; nameOf: (id: string) => string; actOp: (name: string, args: Record<string, unknown>) => Promise<any>; close: () => void; err: string | null }) {
  const owner = p.role === 'owner';
  return (
    <div className="sheet-bg" onClick={close}><div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Team">
      <div className="row spread"><h2 style={{ margin: 0 }}>Team</h2><button className="small" onClick={close}>Close</button></div>
      <Err text={err} />
      {owner && <div className="card"><div className="muted">Team code{p.teamRevoked ? ' (turned off)' : ''}</div><div className="row spread"><div className="code">{p.teamCode}</div><CopyBtn text={p.teamCode ?? ''} /></div>
        <div className="row wrap" style={{ marginTop: 8 }}><button className="small" onClick={() => actOp('regenerateCode', { projectId: p.id })}>New code</button><button className="small danger" onClick={() => actOp('revokeCode', { projectId: p.id })} disabled={!!p.teamRevoked}>Turn off</button></div></div>}
      {p.members.map((m) => (
        <div key={m.userId} className="card"><div className="row spread"><strong>{nameOf(m.userId)}</strong><span className={'tag ' + m.role}>{m.role}</span></div>
          <div className="muted">{m.interests.length ? m.interests.join(', ') : 'No interests listed'}</div>
          {owner && m.role !== 'owner' && <button className="small danger" style={{ marginTop: 8 }} onClick={() => actOp('removeMember', { projectId: p.id, targetId: m.userId })}>Remove</button>}
        </div>
      ))}
      {owner && <div className="card"><div className="row spread"><div className="grow"><strong>Share my AI model</strong><div className="muted">Teammates can use it without seeing the key.</div></div>
        <button className={'chip' + (p.ownerKeySharing ? ' on' : '')} aria-pressed={p.ownerKeySharing} onClick={() => actOp('setOwnerKeySharing', { projectId: p.id, on: !p.ownerKeySharing })}>{p.ownerKeySharing ? 'On' : 'Off'}</button></div></div>}
    </div></div>
  );
}

const RUNNABLE = new Set(['code-review', 'cloudflare-security']);

function SkillsSheet({ p, user, q, setQ, actOp, pid, close, err }: { p: ProjectView; user: string; q: string; setQ: (s: string) => void; actOp: (name: string, args: Record<string, unknown>) => Promise<any>; pid: string; close: () => void; err: string | null }) {
  const items = useMemo(() => searchCatalog(q), [q]); const owner = p.role === 'owner';
  const [runPath, setRunPath] = useState<Record<string, string>>({}); const [output, setOutput] = useState<string | null>(null);
  const run = async (id: string) => {
    const r = await actOp('runSkill', { projectId: pid, skillId: id, path: (runPath[id] ?? '').trim() });
    if (r?.ok) setOutput(r.data.output); // the run also posts a system message to the chat thread
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
              {!added && <button className="small primary" onClick={() => actOp('addSkill', { projectId: pid, skillId: it.id })}>Add</button>}
              {added && <span className="tag">{added.approvedByOwner ? 'approved' : 'waiting for owner'}</span>}
              {added && !added.approvedByOwner && owner && <button className="small" onClick={() => actOp('approveSkill', { projectId: pid, skillId: it.id })}>Approve</button>}
              {added && (owner || added.addedBy === user) && <button className="small danger" onClick={() => { setOutput(null); actOp('removeSkill', { projectId: pid, skillId: it.id }); }}>Remove</button>}
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
