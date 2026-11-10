import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ProviderLabel, TaskStatus } from '../core/types';
import { PROVIDER_LABELS, ROOT_FILES } from '../core/types';
import { PROVIDERS, PROVIDER_ENDPOINTS, keyring, maskKey, providerFor } from '../core/providers';
import { buildTaskPrompt, parseBuildJson } from '../core/execution';
import { planWithProvider } from '../core/planner';
import { searchCatalog, CATALOG, localRunnable, type SkillItem } from '../core/skills';
import { buildPreviewDoc, buildBackendDoc, backendPathFor } from '../core/preview';
import { integrationCheck, reviewFingerprint } from '../core/contract';
import { driveStatus } from '../core/drive';
import { HttpClient, op, type ClientData, type ProjectView } from './client';
import { highlight } from './highlight';
import { Structured } from './markdown';

/**
 * The phone UI talks ONLY to the dev API through ClientData (HttpClient in production,
 * DirectClient in tests). It never sees other members' files, tasks or the team code:
 * the server sends each identity its redacted ProjectView. Test identities, no auth.
 */

type Screen =
  | { name: 'welcome' } | { name: 'home' } | { name: 'create' } | { name: 'invite'; pid: string }
  | { name: 'join' } | { name: 'ai'; pid: string } | { name: 'workspace'; pid: string } | { name: 'discover' };
type Tab = 'chat' | 'code' | 'preview' | 'tasks' | 'files' | 'team' | 'settings';
type Me = { id: string; name: string };
type UserInfo = { id: string; name: string };

const hashParams = () => new URLSearchParams(location.hash.slice(1));
const tabMemory = new Map<string, Tab>(); // tab position survives leaving and returning to a project
const DRAFT_KEY = 'crewcode-mobile-drafts-v1'; // unsent composer text survives reloads and offline gaps
const draftMemory = new Map<string, string>();
try { const raw = localStorage.getItem(DRAFT_KEY); if (raw) for (const [k, v] of Object.entries(JSON.parse(raw))) if (typeof v === 'string') draftMemory.set(k, v); } catch { /* ignore */ }
const persistDrafts = () => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(Object.fromEntries(draftMemory))); } catch { /* ignore */ } };

// Unsaved code edits survive a reload, keyed by user/project/path with the revision they were
// based on. A draft is only restored when the server still has that revision; otherwise the
// normal conflict flow shows both versions.
const EDIT_KEY = 'crewcode-mobile-edits-v1';
const editMemory = new Map<string, { text: string; rev: number }>();
try { const raw = localStorage.getItem(EDIT_KEY); if (raw) for (const [k, v] of Object.entries(JSON.parse(raw))) if (v && typeof (v as any).text === 'string' && typeof (v as any).rev === 'number') editMemory.set(k, v as any); } catch { /* ignore */ }
const persistEdits = () => { try { localStorage.setItem(EDIT_KEY, JSON.stringify(Object.fromEntries(editMemory))); } catch { /* ignore */ } };
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

// Desktop rails (structure per the owner's reference layout; theme unchanged).
// Hidden below 1000px - the mobile layout is untouched. Real data only:
// projects, task counts/statuses, and team members come from live state.
function LeftRail({ me, projects, currentPid, go, enter, signOut }: { me: Me; projects: ProjectView[]; currentPid: string | null; go: (s: Screen) => void; enter: (pid: string) => void; signOut: () => void }) {
  return (
    <aside className="rail" aria-label="Projects navigation">
      <div className="rail-brand">CrewCode</div>
      <button className="rail-nav" onClick={() => go({ name: 'home' })}>Home</button>
      <button className="rail-nav" onClick={() => go({ name: 'home' })}>Projects</button>
      <button className="rail-nav" onClick={() => go({ name: 'discover' })}>Discover</button>
      <button className="rail-nav" onClick={() => go({ name: 'create' })}>+ Create project</button>
      <button className="rail-nav" onClick={() => go({ name: 'join' })}>+ Join project</button>
      <div className="rail-sect">Recent projects</div>
      {projects.map((pr) => (
        <button key={pr.id} className={'rail-proj' + (pr.id === currentPid ? ' on' : '')} onClick={() => enter(pr.id)}>
          <strong>{pr.name}</strong>
          <span className="muted">{pr.members.length} member{pr.members.length === 1 ? '' : 's'}</span>
        </button>
      ))}
      <div className="rail-user"><span className="avatar" aria-hidden>{me.name.slice(0, 1)}</span><span className="grow">{me.name}</span><button className="small" onClick={signOut}>Switch</button></div>
    </aside>
  );
}

function RightRail({ p, me, nameOf, go, manageTools }: { p: ProjectView; me: Me; nameOf: (id: string) => string; go: (t: Tab) => void; manageTools: () => void }) {
  const counts: Record<string, number> = { done: 0, in_progress: 0, todo: 0 };
  p.tasks.forEach((t) => { counts[t.status] = (counts[t.status] ?? 0) + 1; });
  // Technology tags from the files that actually exist in the project.
  const techs = [...new Set(Object.keys(p.files).map((f) => f.includes('.') ? f.split('.').pop()!.toLowerCase() : '').filter((e) => e && e.length <= 5 && e !== 'md'))].sort();
  const openTasks = (uid: string) => p.tasks.filter((t) => t.assigneeId === uid && t.status !== 'done').length;
  return (
    <aside className="rrail" aria-label="Project overview">
      <div className="card">
        <strong>Project overview</strong>
        <div className="muted">{p.name}</div>
        {p.summary && p.summary !== p.name && <div className="muted">{p.summary}</div>}
        {techs.length > 0 && <div className="row wrap" style={{ marginTop: 6 }}>{techs.map((t) => <span key={t} className="tag">{t}</span>)}</div>}
        <div className="row wrap" style={{ marginTop: 6 }}>
          <span className="tag owner">{counts.done} done</span>
          <span className="tag">{counts.in_progress} in progress</span>
          <span className="tag">{counts.todo} to do</span>
        </div>
      </div>
      <div className="card">
        <div className="row spread"><strong>Tasks</strong><span className="muted">{counts.done} of {p.tasks.length} done</span></div>
        {p.tasks.length === 0 && <div className="muted">No tasks yet.</div>}
        {p.tasks.slice(0, 6).map((t) => (
          <div key={t.id} className="row spread" style={{ marginTop: 6 }}>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
            <span className="muted">{nameOf(t.assigneeId)} · {t.status.replace('_', ' ')}</span>
          </div>
        ))}
        <div className="row" style={{ marginTop: 8 }}><button className="small" onClick={() => go('tasks')}>View all</button></div>
      </div>
      <div className="card">
        <strong>AI & tools</strong>
        {(() => { const mine = p.members.find((m) => m.userId === me.id); const ai = mine?.ai;
          return <div className="muted" style={{ marginTop: 6 }}>{ai?.kind === 'own' ? `AI: your ${ai.provider} key` : ai?.kind === 'owner' ? 'AI: owner model' : 'AI: simulated (no key added)'}</div>; })()}
        {p.skills.length === 0 && <div className="muted">No skills or MCPs added.</div>}
        {p.skills.map((it: any) => (
          <div key={it.id} className="row spread" style={{ marginTop: 6 }}>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</span>
            <span className="muted">{it.approvedByOwner ? 'enabled' : 'waiting for owner'}</span>
          </div>
        ))}
        <div className="row" style={{ marginTop: 8 }}><button className="small" onClick={manageTools}>Manage</button></div>
      </div>
      <div className="card">
        <div className="row spread"><strong>Team</strong><button className="small" onClick={() => go('team')}>Manage</button></div>
        {p.members.map((m) => (
          <div key={m.userId} className="row spread" style={{ marginTop: 6 }}>
            <span>{nameOf(m.userId)}</span>
            <span className="muted">{m.role} · {openTasks(m.userId)} open</span>
          </div>
        ))}
      </div>
    </aside>
  );
}

export function App({ client, pollMs = 4000 }: { client?: ClientData; pollMs?: number }) {
  const cli = useMemo<ClientData>(() => client ?? new HttpClient('/api'), [client]);
  const [me, setMeState] = useState<Me | null>(() => (hashParams().get('demo') ? null : loadMe()));
  const setMe = (m: Me | null) => { saveMe(m); setMeState(m); };
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [projects, setProjects] = useState<ProjectView[]>([]);
  const [view, setView] = useState<ProjectView | null>(null);
  const [screen, setScreen] = useState<Screen>(hashParams().get('demo') ? { name: 'welcome' } : (loadMe() ? { name: 'home' } : { name: 'welcome' }));
  const [err, setErr] = useState<string | null>(null);
  const [authInfo, setAuthInfo] = useState<Record<string, unknown> | null>(null);
  const deployed = !!authInfo && authInfo.deployment === 'vercel-serverless';
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
        if (g.ok && g.data.tasks.length === 0) { await op(cli, 'u-ram', 'assignTasks', { projectId: pid }); await op(cli, 'u-ram', 'confirmPlanning', { projectId: pid, accept: true }); g = await op(cli, 'u-seeta', 'getProject', { projectId: pid }); } // demo scaffolding auto-approves
        if (g.ok && g.data.tasks[0] && !g.data.files['home/index.html']) await op(cli, 'u-seeta', 'runBuild', { projectId: pid, taskId: g.data.tasks[0].id });
        const me0: Me = who === 'seeta' ? { id: 'u-seeta', name: 'Seeta' } : { id: 'u-ram', name: 'Ram' };
        if (!cancelled) { setMe(me0); await refreshFor(me0.id, pid); go({ name: 'workspace', pid }); }
        return;
      }
      // Deployment detection only applies to the real HTTP client; injected
      // clients (tests, offline demo) have no server to ask.
      let info: Record<string, unknown> | null = null;
      if (!client) {
        try { const r = await fetch('/api/auth/status'); info = r.ok ? await r.json() : null; } catch { info = null; }
      }
      if (cancelled) return;
      setAuthInfo(info);
      const isDeployed = !!info && info.deployment === 'vercel-serverless';
      if (isDeployed && !info!.session) { setMe(null); return; } // server-enforced identity: no roster, no stale local identity without a session
      const u = await cli.call({ as: 'u-ram', op: 'listUsers' });
      if (!cancelled) { if (u.ok) setUsers(u.data); else if (!isDeployed) setErr(u.error); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cli]);

  const refreshFor = async (userId: string, pid?: string | null) => {
    const l = await op(cli, userId, 'listProjects');
    if (l.ok) setProjects(l.data); else { setErr(l.error); return null; }
    if (pid) {
      const g = await op(cli, userId, 'getProject', { projectId: pid });
      if (g.ok) setView(g.data); else setErr(g.error);
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
    if (!r.ok) { setErr(r.error); return r; }
    setErr(null);
    await refreshFor(me.id, pid ?? (screen.name === 'workspace' || screen.name === 'ai' || screen.name === 'invite' ? screen.pid : null));
    return r;
  };

  return (
    <div className="app">
      <div className="banner">{deployed
        ? 'AI answers are simulated until you add your own key; previews run real web files.'
        : 'Test identities only. Not a login. Real sign-in is built last. AI answers are simulated until you add your own key; previews run real web files.'}</div>
      {err && screen.name !== 'workspace' && <div style={{ padding: 16 }}><Err text={err} /><button onClick={() => window.location.reload()}>Retry connection</button></div>}
      {screen.name === 'welcome' && <Welcome users={users} deployed={deployed} signIn={authInfo?.githubSignIn === 'configured' && authInfo?.storage !== 'not-configured'} signInPending={authInfo?.githubSignIn === 'configured' && authInfo?.storage === 'not-configured'} session={!!authInfo?.session} pick={(u) => { setMe(u); go({ name: 'home' }); }}
        register={async (name) => {
          const r = await cli.call({ as: 'u-ram', op: 'registerName', args: { name } });
          if (!r.ok) return r.error;
          const u = await cli.call({ as: 'u-ram', op: 'listUsers' });
          if (u.ok) setUsers(u.data);
          setMe({ id: r.data.userId, name: name.trim() });
          go({ name: 'home' });
          return null;
        }} />}
      {me && (
        <div className="shell">
          <LeftRail me={me} projects={projects} currentPid={screen.name === 'workspace' ? screen.pid : null} go={go} enter={enterProject} signOut={() => { setMe(null); setView(null); go({ name: 'welcome' }); }} />
          <div className="shell-main">
      {screen.name === 'home' && <Home me={me} projects={projects} refresh={() => refreshFor(me.id)} go={go} enter={enterProject} signOut={() => { setMe(null); setView(null); go({ name: 'welcome' }); }} />}
      {screen.name === 'discover' && <DiscoverView />}
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
      {screen.name === 'workspace' && <Workspace me={me} view={view} pid={screen.pid} load={() => refreshFor(me.id, screen.pid)} actOp={actOp} go={go} err={err} clearErr={() => setErr(null)} pollMs={pollMs}
        checkVersion={async () => { const r = await op(cli, me.id, 'getVersion'); return r.ok ? (r.data.version as number) : null; }} />}
          </div>
        </div>
      )}
    </div>
  );
}

function Err({ text }: { text: string | null }) { return text ? <div className="err" role="alert">{text}</div> : null; }

function Welcome({ users, pick, register, deployed, signIn, signInPending, session }: { users: UserInfo[]; pick: (u: Me) => void; register: (name: string) => Promise<string | null>; deployed?: boolean; signIn?: boolean; signInPending?: boolean; session?: boolean }) {
  const [name, setName] = useState(''); const [err, setErr] = useState<string | null>(null);
  return (
    <div className="screen">
      <h1>CrewCode</h1>
      <p className="muted">Build software with your team in a chat. The owner's AI splits the work. Each person sees only their part.</p>
      {deployed && !session && (
        signIn
          ? <a className="chip primary block" style={{ textAlign: 'center', marginTop: 12 }} href="/api/auth/github">Sign in with GitHub</a>
          : <p className="muted" style={{ marginTop: 12 }}>{signInPending ? 'GitHub sign-in is being set up: durable storage is not configured on this deployment yet.' : 'GitHub sign-in is not configured on this deployment yet.'}</p>
      )}
      {(!deployed || session) && (<>
      <h2>{deployed ? 'Pick your account' : 'Pick a test identity'}</h2>
      <div className="row wrap">
        {users.map((u) => (
          <button key={u.id} className="chip" onClick={() => pick(u)}>{u.name}</button>
        ))}
      </div>
      <h2>{deployed ? 'Or add your name' : 'Or register a name'}</h2>
      <label htmlFor="nm">Your name</label>
      <input id="nm" value={name} onChange={(e) => { setName(e.target.value); setErr(null); }} placeholder="e.g. Asha" autoComplete="off" />
      <Err text={err} />
      <button className="primary block" style={{ marginTop: 12 }} onClick={async () => setErr(await register(name))}>Continue</button>
      </>)}
    </div>
  );
}

function Home({ me, projects, refresh, go, enter, signOut }: { me: Me; projects: ProjectView[]; refresh: () => Promise<unknown>; go: (s: Screen) => void; enter: (pid: string) => Promise<void>; signOut: () => void }) {
  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="topbar home-top"><div className="title">Hi, {me.name}</div><button className="small" onClick={signOut}>Switch</button></div>
      <div className="screen">
        <div className="row home-actions"><button className="primary grow" onClick={() => go({ name: 'create' })}>Create project</button><button className="grow" onClick={() => go({ name: 'join' })}>Join project</button></div>
        <h2>Your projects</h2>
        {projects.length === 0 && <div className="empty">No projects yet. Create one, or join with a team code.</div>}
        {projects.map((p) => {
          const m = p.members.find((x) => x.userId === me.id);
          if (!m) return null; // stale entry from a previous identity before the list refreshes
          const last = p.messages.at(-1);
          return (
            <button key={p.id} className="card block" style={{ textAlign: 'left', display: 'block' }} onClick={() => enter(p.id)}>
              <div className="row spread"><strong style={{ overflowWrap: 'anywhere' }}>{p.name}</strong><span className={'tag ' + m.role}>{m.role}</span></div>
              <div className="muted">{p.summary || (last ? last.text.slice(0, 80) : 'No description yet')}</div>
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
  const [kind, setKind] = useState<'owner' | 'own'>('owner'); const [prov, setProv] = useState<ProviderLabel | null>(null); const [endpointId, setEndpointId] = useState<string | null>(null);
  const [model, setModel] = useState(''); const [key, setKey] = useState(''); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (!v) load().then((x) => setV(x)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!v) return <div className="screen">Project not found.</div>;
  const owner = v.role === 'owner'; const sharing = owner || v.ownerKeySharing;
  // A key makes real calls: the owner's own key for the owner model, your own key otherwise.
  // A teammate on the owner model stays simulated until hosted key storage exists (auth-gated).
  const keySection = (kind === 'own' || owner) && (
    <>
      <div className="row wrap">{PROVIDER_LABELS.map((l) => <button key={l} className={'chip' + (prov === l ? ' on' : '')} aria-pressed={prov === l} onClick={() => { setProv(l); setEndpointId(null); }}>{l}</button>)}</div>
      {prov && <div className="note">{PROVIDERS.find((x) => x.label === prov)!.note}</div>}
      {prov && PROVIDER_ENDPOINTS[prov].length > 1 && <div className="row wrap">{PROVIDER_ENDPOINTS[prov].map((e) => <button key={e.id} className={'chip' + (endpointId === e.id ? ' on' : '')} aria-pressed={endpointId === e.id} onClick={() => setEndpointId(e.id)}>{e.label}</button>)}</div>}
      {prov && <><label htmlFor="mdl">Model</label>
        <input id="mdl" value={model} onChange={(e) => setModel(e.target.value)} placeholder="Model name from your provider" autoComplete="off" />
        <label htmlFor="k">API key</label>
        <input id="k" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste a key" autoComplete="off" />
        {key && <p className="muted">Shown as {maskKey(key)}. Kept in memory on this device only. Calls go straight from this device to the provider.</p>}
        {!key && kind === 'owner' && owner && <p className="muted">No key added: the owner model stays simulated.</p>}
      </>}
    </>
  );
  return (
    <div className="screen">
      <h1>Choose your AI</h1>
      <p className="muted">Without a key, answers are simulated. With your own key, builds and planning call the real provider from this device.</p>
      <button className={'card block'} disabled={!sharing} aria-pressed={kind === 'owner'} onClick={() => setKind('owner')} style={{ textAlign: 'left', borderColor: kind === 'owner' ? 'var(--accent)' : undefined }}>
        <strong>{owner ? 'My model' : "Owner's AI model"}</strong>
        <div className="muted">{sharing ? (owner ? 'Uses the key you add as owner. Never shown to teammates.' : "Uses the owner's key. You will never see it. Simulated in this build.") : 'The owner turned this off.'}</div>
      </button>
      <button className="card block" aria-pressed={kind === 'own'} onClick={() => setKind('own')} style={{ textAlign: 'left', borderColor: kind === 'own' ? 'var(--accent)' : undefined }}>
        <strong>My own API key</strong><div className="muted">Kept in memory on this device only. Not saved.</div>
      </button>
      {keySection}
      <Err text={err} />
      <button className="primary block" style={{ marginTop: 12 }} onClick={async () => {
        const wantsKey = kind === 'own' || owner;
        if (wantsKey && prov) {
          const eps = PROVIDER_ENDPOINTS[prov];
          const ep = eps.length === 1 ? eps[0] : eps.find((e) => e.id === endpointId);
          if (!ep) return setErr('Pick which provider this is.');
          if (!key.trim()) {
            if (kind === 'own') return setErr('Paste a key, or choose the owner model.');
          } else {
            if (!model.trim()) return setErr('Enter the model name from your provider.');
            keyring.set(me.id, prov, { key: key.trim(), endpointId: ep.id, model: model.trim() });
          }
        } else if (kind === 'own') return setErr('Pick a provider.');
        setErr(await save(kind === 'owner' ? { kind: 'owner', provider: prov ?? undefined } : { kind: 'own', provider: prov! }));
      }}>Continue</button>
    </div>
  );
}

function Workspace({ me, view, pid, load, actOp, go, err, clearErr, checkVersion, pollMs = 4000 }: { me: Me; view: ProjectView | null; pid: string; load: () => Promise<ProjectView | null>; actOp: (name: string, args: Record<string, unknown>, pid?: string) => Promise<any>; go: (s: Screen) => void; err: string | null; clearErr: () => void; checkVersion?: () => Promise<number | null>; pollMs?: number }) {
  const [tab, setTabState] = useState<Tab>((hashParams().get('tab') as Tab) || tabMemory.get(pid) || 'chat');
  const setTab = (t: Tab) => { tabMemory.set(pid, t); setTabState(t); };
  const [draft, setDraftState] = useState(() => draftMemory.get(pid) ?? '');
  const [suggest, setSuggest] = useState<{ proposal: { op: string; args: Record<string, unknown> }; consequence: string } | null>(null);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  const setDraft = (d: string) => { draftMemory.set(pid, d); persistDrafts(); setDraftState(d); };
  const [sheet, setSheet] = useState<null | 'team' | 'skills' | 'overview' | 'notif'>((hashParams().get('sheet') as 'team' | 'skills') || null); const [q, setQ] = useState(''); const [open, setOpen] = useState<string | null>(null);
  const [notifSeen, setNotifSeen] = useState(() => { try { return Number(localStorage.getItem(`notifSeen:${me.id}:${pid}`)) || 0; } catch { return 0; } });
  const [thread, setThread] = useState<string | null>(null);
  const [backupJson, setBackupJson] = useState('');
  const editKey = (path: string) => `${me.id}:${pid}:${path}`;
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const p = view && view.id === pid ? view : null;
  // Cross-session propagation: poll the server mutation counter and reload when another
  // session (or device) changed the project. Reloading preserves local drafts and surfaces
  // edit conflicts instead of overwriting - the same path as a manual reload.
  const verRef = useRef<number | null>(null);
  useEffect(() => { if (p?.stateVersion != null) verRef.current = p.stateVersion; }, [p?.stateVersion]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSheet(null);
      // Never steal Ctrl/Cmd+digit (or the browser's own tab keys) while the user is typing.
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && !typing) {
        const order: Tab[] = ['chat', 'code', 'preview', 'tasks', 'files', 'team', 'settings'];
        const i = Number(e.key) - 1;
        if (i >= 0 && i < order.length) { e.preventDefault(); setTab(order[i]); clearErr(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!checkVersion || !pollMs) return;
    const t = setInterval(async () => {
      const v = await checkVersion();
      if (v == null) return;
      if (verRef.current == null) { verRef.current = v; return; }
      if (v !== verRef.current) { verRef.current = v; await load(); }
    }, pollMs);
    return () => clearInterval(t);
  }, [pid, pollMs]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!p) return <div className="screen">Loading...</div>;
  const owner = p.role === 'owner';
  const nameOf = (id: string) => (id === 'ai' ? 'AI' : p.names[id] ?? 'Unknown');
  const notifSeenKey = `notifSeen:${me.id}:${pid}`;
  const events = p.messages.filter((m) => m.kind !== 'prompt');
  const unread = events.filter((m) => m.at > notifSeen).length;
  const openNotif = () => { setSheet('notif'); const latest = events.length ? events[events.length - 1].at : Date.now(); setNotifSeen(latest); try { localStorage.setItem(notifSeenKey, String(latest)); } catch { /* ignore */ } };
  const tasks = p.tasks;
  const activeThread = owner ? thread : (thread ?? tasks[0]?.id ?? null);
  const msgs = owner && activeThread ? p.messages.filter((m) => m.taskId === activeThread) : p.messages;

  return (
    <div className="ws">
    <div className="ws-main">
      <div className="topbar">
        <button className="small" onClick={() => go({ name: 'home' })}>Back</button>
        <div className="title">{p.name}</div>
        <span className={'tag ' + (owner ? 'owner' : '')}>{owner ? 'owner' : 'teammate'}</span>
        <button className="small" onClick={() => setSheet('team')}>Team</button>
        <button className="small" aria-label="Notifications" onClick={openNotif}>Alerts{unread > 0 ? ` (${unread})` : ''}</button>
        <button className="small mob-only" onClick={() => setSheet('overview')}>Overview</button>
      </div>
      <div className="search">
        <input aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search skills, MCPs, tools" onFocus={() => q === '' && undefined} />
        <button className="small" onClick={() => setSheet('skills')} aria-label="Add skills and MCPs">Add</button>
      </div>
      {tab === 'chat' && <ChatView p={p} user={me.id} nameOf={nameOf} msgs={msgs} tasks={tasks} owner={owner} thread={activeThread} setThread={setThread}
        realAi={(() => { const a = p.members.find((m) => m.userId === me.id)?.ai; return !!(a?.provider && (a.kind === 'own' || owner) && keyring.has(me.id, a.provider)); })()}
        onConfirm={async (accept: boolean, reassign: Record<number, string>) => {
          await actOp('confirmPlanning', { projectId: pid, accept, reassign }, pid);
        }}
        onAssign={async () => {
          const a = p.members.find((m) => m.userId === me.id)?.ai;
          const provider = a?.provider && owner ? providerFor(me.id, a.provider) : null;
          if (!provider) { await actOp('assignTasks', { projectId: pid }, pid); return; }
          const started = await actOp('startPlanning', { projectId: pid }, pid);
          if (!started?.ok) return;
          const users = Object.entries(p.names).map(([id, name]) => ({ id, name }));
          const outcome = await planWithProvider(provider, { name: p.name, files: p.files, members: p.members.filter((m) => m.role === 'teammate') }, users);
          await actOp('applyPlanning', { projectId: pid, outcome, simulated: false }, pid);
        }}
        onBuild={async (id: string, force: boolean) => {
          const a = p.members.find((m) => m.userId === me.id)?.ai;
          const provider = !force && a?.provider && (a.kind === 'own' || owner) ? providerFor(me.id, a.provider) : null;
          if (!provider) { await actOp('runBuild', { projectId: pid, taskId: id, forceError: force, prompt: draftMemory.get(pid) ?? '' }, pid); return; }
          const task = p.tasks.find((t) => t.id === id);
          if (!task) return;
          const started = await actOp('startTaskRun', { projectId: pid, taskId: id }, pid);
          if (!started?.ok) return;
          const res = await provider.complete(buildTaskPrompt(task, { name: p.name, files: p.files }, draftMemory.get(pid) ?? ''));
          const result = res.ok ? parseBuildJson(res.text, task.folder) : res;
          await actOp('applyTaskRun', { projectId: pid, taskId: id, result, simulated: false }, pid);
        }}
        onCancel={(id: string) => actOp('cancelTaskRun', { projectId: pid, taskId: id }, pid)} openCode={(f: string) => { setOpen(f); setTab('code'); }} goTab={setTab} err={err} />}
      {tab === 'code' && <CodeView p={p} open={open} setOpen={setOpen} editKey={editKey} onSave={(path, c, rev) => actOp('saveFile', { projectId: pid, path, content: c, baseRev: rev }, pid)} reload={() => load()} err={err} clearErr={clearErr} />}
      {tab === 'preview' && <PreviewView p={p} />}
      {tab === 'tasks' && <TasksView p={p} user={me.id} nameOf={nameOf} onStatus={(id, s) => actOp('setTaskStatus', { projectId: pid, taskId: id, status: s }, pid)} actOp={(n, a) => actOp(n, a, pid)} err={err} />}
      {tab === 'files' && <FilesView p={p} />}
      {tab === 'team' && <TeamSheet p={p} user={me.id} nameOf={nameOf} actOp={(n, a) => actOp(n, a, pid)} close={() => setTab('chat')} err={err} backupJson={backupJson} setBackupJson={setBackupJson} inline />}
      {tab === 'settings' && <SettingsView p={p} me={me} go={go} actOp={(n, a) => actOp(n, a, pid)} />}
      {tab === 'chat' && (
        <div className="composer">
          {suggest && (
            // Suggestion preview: proposed by the local Needle model, validated for shape.
            // It runs ONLY via this Run button through the normal gated actOp path.
            // Approvals are never suggested - those stay on the owner's native UI.
            <div className="card" role="region" aria-label="Suggested action">
              <strong>Suggested action (local model):</strong>
              <div>{suggest.consequence}</div>
              <div className="muted">{(() => { const eff = suggest.proposal.op === 'createProject' ? suggest.proposal.args : { ...suggest.proposal.args, projectId: pid }; return suggest.proposal.op + '(' + Object.entries(eff).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ') + ')'; })()}</div>
              <div className="row">
                <button className="small primary" onClick={async () => { const pr = suggest.proposal; setSuggest(null); await actOp(pr.op, pr.op === 'createProject' ? pr.args : { ...pr.args, projectId: pid }, pr.op === 'createProject' ? undefined : pid); }}>Run</button>
                <button className="small" onClick={() => setSuggest(null)}>Dismiss</button>
              </div>
            </div>
          )}
          {suggestNote && <div className="muted">{suggestNote}</div>}
          <textarea aria-label="Message" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={owner || activeThread ? 'Message the AI' : 'No task assigned yet'} />
          <button className="primary" onClick={async () => { const r = await actOp('postPrompt', { projectId: pid, text: draft, taskId: activeThread }, pid); if (r?.ok) setDraft(''); }}>Send</button>
          <button className="small" onClick={async () => {
            setSuggest(null); setSuggestNote(null);
            const r = await actOp('suggestAction', { projectId: pid, text: draft }, pid);
            if (!r?.ok) { setSuggestNote('Suggestions unavailable on this server.'); return; }
            const d = r.data as { proposal: { op: string; args: Record<string, unknown> } | null; consequence?: string; note?: string };
            if (d.proposal) setSuggest({ proposal: d.proposal, consequence: d.consequence ?? '' });
            else setSuggestNote(d.note ?? 'No confident suggestion.');
          }}>Suggest</button>
        </div>
      )}
      <div className="tabs" role="tablist">
        {(['chat', 'code', 'preview', 'tasks', 'files', 'team', 'settings'] as Tab[]).map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => { setTab(t); clearErr(); }}>{t[0].toUpperCase() + t.slice(1)}</button>)}
      </div>
      {sheet === 'team' && <TeamSheet p={p} user={me.id} nameOf={nameOf} actOp={(n, a) => actOp(n, a, pid)} close={() => setSheet(null)} err={err} backupJson={backupJson} setBackupJson={setBackupJson} />}
      {sheet === 'skills' && <SkillsSheet p={p} user={me.id} q={q} setQ={setQ} actOp={(n, a) => actOp(n, a, pid)} pid={pid} close={() => setSheet(null)} err={err} />}
      {sheet === 'overview' && <div className="sheet-bg" onClick={() => setSheet(null)}><div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Project overview"><RightRail p={p} me={me} nameOf={nameOf} go={(t) => { setTab(t); setSheet(null); }} manageTools={() => setSheet('skills')} /></div></div>}
      {sheet === 'notif' && (
        <div className="sheet-bg" onClick={() => setSheet(null)}><div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Notifications">
          <div className="row spread"><h2>Notifications</h2><button className="small" onClick={() => setSheet(null)}>Close</button></div>
          {events.length === 0 && <div className="empty">No activity yet. AI plans, builds and errors show up here.</div>}
          {events.slice(-12).reverse().map((m) => (
            <div key={m.id} className="card">
              <div className="muted">{new Date(m.at).toLocaleString()} · {m.kind === 'ai_build' ? (m.simulated === false ? 'AI build' : 'simulated build') : m.kind === 'ai_error' ? 'build error' : m.kind === 'ai_plan' ? 'plan' : 'system'}</div>
              <Structured text={m.text} />
              {m.files && m.files.length > 0 && <div className="row wrap" style={{ marginTop: 6 }}>{m.files.map((f) => <button key={f} className="small" onClick={() => { setSheet(null); setOpen(f); setTab('code'); }}>{f}</button>)}</div>}
            </div>
          ))}
        </div></div>
      )}
    </div>
    <RightRail p={p} me={me} nameOf={nameOf} go={setTab} manageTools={() => setSheet('skills')} />
    </div>
  );
}

function ChatView({ p, user, nameOf, msgs, tasks, owner, thread, setThread, realAi, onAssign, onBuild, onCancel, openCode, onConfirm, goTab, err }: Record<string, any>) {
  const [reassign, setReassign] = useState<Record<number, string>>({});
  const myTask = !owner ? (tasks.find((t: any) => t.id === thread) ?? tasks[0]) : tasks.find((t: any) => t.id === thread);
  return (
    <div className="screen">
      {owner && tasks.length > 0 && (
        <div className="files">
          <button className={'chip small' + (thread === null ? ' on' : '')} onClick={() => setThread(null)}>Project</button>
          {tasks.map((t: any) => <button key={t.id} title={nameOf(t.assigneeId)} className={'chip small' + (thread === t.id ? ' on' : '')} onClick={() => setThread(t.id)}>{t.title}</button>)}
        </div>
      )}
      {!owner && tasks.length > 1 && <div className="row wrap" style={{ marginBottom: 8 }}>{tasks.map((t: any) => <button key={t.id} className={'chip small' + (thread === t.id ? ' on' : '')} onClick={() => setThread(t.id)}>{t.folder}</button>)}</div>}
      {!owner && myTask && <div className="card"><strong>{myTask.title}</strong><div className="muted">Folder: {myTask.folder}</div></div>}
      {!owner && !myTask && <div className="empty">You have no task yet. The owner's AI assigns features from the project prompt.</div>}
      {owner && p.proposedPlan && (
        <div className="card" role="region" aria-label="Proposed plan"><strong>Review the proposed split</strong>
          <p className="muted">Nothing is assigned yet. Approve to create these tasks, reassign a feature first, or discard and re-run.</p>
          {p.proposedPlan.map((t: any, i: number) => (
            <div key={t.folder} className="row spread" style={{ alignItems: 'center', marginTop: 6 }}>
              <div><strong>{t.folder}</strong> {t.title}{t.deps?.length ? <span className="muted"> - after {t.deps.join(', ')}</span> : ''}</div>
              <select aria-label={`Assign ${t.folder}`} value={reassign[i] ?? t.assigneeId} onChange={(e) => setReassign({ ...reassign, [i]: e.target.value })}>
                {p.members.filter((m: any) => m.role === 'teammate').map((m: any) => <option key={m.userId} value={m.userId}>{nameOf(m.userId)}</option>)}
              </select>
            </div>
          ))}
          <div className="row" style={{ marginTop: 10 }}>
            <button className="primary" onClick={() => onConfirm(true, reassign)}>Approve plan</button>
            <button className="small" onClick={() => onConfirm(false, {})}>Discard</button>
          </div>
        </div>
      )}
      {owner && !p.proposedPlan && p.tasks.length === 0 && (
        <div className="card"><strong>Ready to divide the work?</strong><p className="muted">{realAi ? 'Your AI reads PRD.md and assigns a folder to each teammate by interest.' : 'The simulated AI reads PRD.md and assigns a folder to each teammate by interest.'}</p>
          <button className="primary" onClick={onAssign} disabled={p.members.length < 2}>{p.members.length < 2 ? 'Waiting for teammates' : realAi ? 'Assign tasks' : 'Assign tasks (simulated)'}</button></div>
      )}
      <Err text={err} />
      <div className="chat">
        {msgs.length === 0 && myTask !== undefined && <div className="empty">No messages yet.</div>}
        {msgs.map((m: any) => {
          const mine = m.authorId === user; const ai = m.authorId === 'ai';
          return (
            <div key={m.id} className={'bubble ' + (mine ? 'me' : ai ? 'ai' : 'other') + (m.kind === 'ai_error' ? ' error' : '')}>
              {!mine && <div className="who">{nameOf(m.authorId)}{m.kind === 'ai_build' && m.simulated !== false ? ' - simulated build' : ''}</div>}
              {ai ? <Structured text={m.text} /> : m.text}
              {m.kind === 'ai_build' && m.files?.length > 0 && (() => {
                const totals: { added: number; removed: number } = Object.values((m.diff ?? {}) as Record<string, { added: number; removed: number }>).reduce((a, d) => ({ added: a.added + d.added, removed: a.removed + d.removed }), { added: 0, removed: 0 });
                const rows = m.files.map((f: string) => (
                  <div key={f} className="row spread" style={{ marginTop: 4 }}>
                    <button className="small" onClick={() => openCode(f)}>{'</>'} {f}</button>
                    {m.diff?.[f] && <span className="muted">+{m.diff[f].added} -{m.diff[f].removed}</span>}
                  </div>
                ));
                return (
                  <div style={{ marginTop: 8 }}>
                    {m.files.length > 3 ? (
                      <details className="buildlog">
                        <summary>{m.files.length} changed files ({totals.added > 0 || totals.removed > 0 ? `+${totals.added} -${totals.removed}` : 'no line counts'})</summary>
                        {rows}
                      </details>
                    ) : rows}
                    <div className="row wrap" style={{ marginTop: 6 }}>
                      <button className="small" onClick={() => openCode(m.files[0])}>Open Code</button>
                      <button className="small" onClick={() => goTab('preview')}>Open Preview</button>
                      <button className="small" onClick={() => goTab('tasks')}>View Tasks</button>
                    </div>
                  </div>
                );
              })()}
              {m.kind === 'ai_error' && myTask && <div style={{ marginTop: 8 }}><button className="small" onClick={() => onBuild(myTask.id, false)}>Retry</button></div>}
            </div>
          );
        })}
      </div>
      {myTask && (
        <div className="row wrap" style={{ marginTop: 12 }}>
          <button onClick={() => onBuild(myTask.id, false)} disabled={myTask.run === 'thinking'}>{myTask.run === 'thinking' ? 'AI thinking...' : realAi ? 'Run build' : 'Run simulated build'}</button>
          {myTask.run === 'thinking' && <button onClick={() => onCancel(myTask.id)}>Stop</button>}
          <button onClick={() => onBuild(myTask.id, true)} disabled={myTask.run === 'thinking'} aria-label="Simulate an error">Simulate error</button>
        </div>
      )}
      {myTask?.run === 'failed' && myTask.runError && <div className="note">{myTask.runError}</div>}
    </div>
  );
}

function CodeView({ p, open, setOpen, editKey, onSave, reload, err, clearErr }: { p: ProjectView; open: string | null; setOpen: (f: string | null) => void; editKey: (path: string) => string; onSave: (path: string, c: string, rev: number) => Promise<any>; reload: () => Promise<unknown>; err: string | null; clearErr: () => void }) {
  const [fq, setFq] = useState('');
  const filesAll = Object.keys(p.files).sort();
  const files = fq.trim() ? filesAll.filter((f) => f.toLowerCase().includes(fq.trim().toLowerCase())) : filesAll;
  const path = open && filesAll.includes(open) ? open : filesAll.find((f) => canWriteView(p, f)) ?? filesAll[0] ?? null;
  const [text, setText] = useState(''); const [dirty, setDirty] = useState(false); const [rev, setRev] = useState(0);
  const hlRef = useRef<HTMLPreElement>(null);
  const [conflict, setConflict] = useState<{ mine: string } | null>(null);
  const [adding, setAdding] = useState(false); const [newName, setNewName] = useState(''); const [newErr, setNewErr] = useState<string | null>(null);
  // Open-file tabs: every focused file stays open until closed; unsaved drafts mark a dot.
  const [tabs, setTabs] = useState<string[]>(() => (path ? [path] : []));
  useEffect(() => { if (path && !tabs.includes(path)) setTabs((ts) => [...ts, path]); }, [path]); // eslint-disable-line react-hooks/exhaustive-deps
  const openTab = (f: string) => { setOpen(f); clearErr(); };
  const closeTab = (f: string) => {
    const next = tabs.filter((t) => t !== f);
    setTabs(next);
    if (f === path) setOpen(next[next.length - 1] ?? null);
  };
  const isDirtyTab = (f: string) => { const d = editMemory.get(editKey(f)); return !!d && d.text !== (p.files[f] ?? ''); };
  // Duplicate basenames across open tabs get their folder shown so they stay distinguishable.
  const tabLabel = (f: string) => { const base = f.slice(f.lastIndexOf('/') + 1); return tabs.some((t) => t !== f && t.slice(t.lastIndexOf('/') + 1) === base) ? f : base; };
  const history = p.messages.filter((m) => m.kind === 'ai_build' && m.files && m.files.length > 0).slice(-8).reverse();
  // Folders this user may create files in, derived from the redacted view (mirrors the server gate).
  const roots = p.role === 'owner' ? [''] : [...new Set(p.tasks.map((t) => t.folder))];
  const createFile = async () => {
    const name = newName.trim();
    const parts = name.split('/');
    if (!name || name.startsWith('/') || name.includes('\\') || name.includes('\0') || parts.some((s) => s === '' || s === '.' || s === '..')) { setNewErr('Use a plain relative path like ' + (roots[0] || 'folder/') + 'name.ext - no leading slash, no ..'); return; }
    if (p.files[name] !== undefined) { setNewErr(name + ' already exists. Open it from the file list instead.'); return; }
    if (!roots.some((r) => name.startsWith(r))) { setNewErr(p.role === 'owner' ? 'That path is not valid.' : 'You can only create files inside your folder (' + roots.join(', ') + ').'); return; }
    // baseRev 0 means "must not exist yet": if someone else created it first, this conflicts instead of overwriting.
    const r = await onSave(name, '', 0);
    if (r?.ok) { setAdding(false); setNewName(''); setNewErr(null); setOpen(name); }
  };
  const newFileRow = roots.length > 0 && (
    <div style={{ marginBottom: 8 }}>
      <input aria-label="Search files" value={fq} onChange={(e) => setFq(e.target.value)} placeholder="Search files" style={{ marginBottom: 8 }} />
      {!adding && <button className="small" onClick={() => { setAdding(true); setNewName(roots[0] ?? ''); setNewErr(null); }}>New file</button>}
      {adding && (
        <div className="row wrap">
          <input aria-label="New file path" value={newName} onChange={(e) => { setNewName(e.target.value); setNewErr(null); }} placeholder={(roots[0] || 'folder/') + 'name.ext'} style={{ flex: 1, minWidth: 0 }} />
          <button className="small primary" onClick={createFile}>Create</button>
          <button className="small" onClick={() => { setAdding(false); setNewErr(null); }}>Cancel</button>
        </div>
      )}
      {newErr && <div className="err" role="alert">{newErr}</div>}
    </div>
  );
  useEffect(() => {
    const serverRev = path ? p.fileRevs?.[path] ?? 0 : 0;
    const draft = path ? editMemory.get(editKey(path)) : undefined;
    const current = path ? p.files[path] ?? '' : '';
    if (draft && draft.rev !== serverRev && draft.text !== current) {
      // The file changed while the draft was stored: keep the draft and open the
      // conflict review instead of dropping the work.
      setText(draft.text); setRev(serverRev); setDirty(true); setConflict({ mine: draft.text });
    } else if (draft && draft.text !== current) { setText(draft.text); setRev(serverRev); setDirty(true); setConflict(null); }
    else { setText(current); setRev(serverRev); setDirty(false); setConflict(null); }
  }, [path, p.files]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!path) return <div className="screen">{newFileRow || <div className="empty">No files you can open yet.</div>}</div>;
  const editable = canWriteView(p, path);
  const t = p.tasks[0];
  const findings = p.role !== 'owner' && t ? integrationCheck(p.files['CONTRACT.md'], p.files, t.folder) : [];
  const save = async () => {
    const r = await onSave(path, text, rev);
    if (r?.ok) { editMemory.delete(editKey(path)); persistEdits(); }
    if (r && !r.ok && typeof r.error === 'string' && r.error.startsWith('Conflict:')) {
      const fresh = await reload(); // pull the other person's version for review; never overwrite silently
      void fresh;
      setConflict({ mine: text });
    }
  };
  const serverText = p.files[path] ?? '';
  const serverRev = p.fileRevs?.[path] ?? 0;
  return (
    <div className="screen">
      <div className="files ftree" role="tree" aria-label="File explorer">
        {files.filter((f) => !f.includes('/')).map((f) => (
          <button key={f} className={'chip small frow rootfile' + (f === path ? ' on' : '')} onClick={() => openTab(f)}>{isDirtyTab(f) && <span className="fdot" />}{f}</button>
        ))}
        {[...new Set(files.filter((f) => f.includes('/')).map((f) => f.slice(0, f.lastIndexOf('/') + 1)))].map((dir) => (
          <details key={dir} open>
            <summary>{dir}</summary>
            {files.filter((f) => f.startsWith(dir)).map((f) => (
              <button key={f} className={'chip small frow' + (f === path ? ' on' : '')} onClick={() => openTab(f)}>{isDirtyTab(f) && <span className="fdot" />}{f.slice(dir.length)}</button>
            ))}
          </details>
        ))}
        {files.length === 0 && <div className="empty">No files match "{fq}".</div>}
      </div>
      {newFileRow}
      {tabs.length > 0 && (
        <div className="ftabs" aria-label="Open files">
          {tabs.map((f) => (
            <span key={f} className={'ftab' + (f === path ? ' on' : '')}>
              <button title={f} onClick={() => openTab(f)}>{isDirtyTab(f) && <span className="fdot" />}{tabLabel(f)}</button>
              <button className="fx" aria-label={'Close ' + f} onClick={() => closeTab(f)}>x</button>
            </span>
          ))}
        </div>
      )}
      <div className="row spread"><strong style={{ overflowWrap: 'anywhere' }}>{path}</strong><span className="tag">{editable ? 'editable' : 'read only'}</span></div>
      {!editable && <div className="note">You can read this file. Only the owner can change it.</div>}
      {conflict && (
        <div className="card" role="alert">
          <strong>Someone changed this file while you were editing.</strong>
          <p className="muted">Your edit was not saved. Review both versions, then choose. Nothing is overwritten silently.</p>
          <div className="muted">Their saved version:</div>
          <pre className="editor" style={{ whiteSpace: 'pre-wrap', minHeight: 0, maxHeight: 140, overflow: 'auto' }}>{serverText.slice(0, 2000)}</pre>
          <div className="row wrap" style={{ marginTop: 8 }}>
            <button className="small" onClick={() => { setText(serverText); setRev(serverRev); setDirty(false); setConflict(null); editMemory.delete(editKey(path)); persistEdits(); }}>Use their version</button>
            <button className="small primary" onClick={async () => { const r = await onSave(path, conflict.mine, serverRev); if (r?.ok) { setText(conflict.mine); setDirty(false); setConflict(null); editMemory.delete(editKey(path)); persistEdits(); } }}>Keep my version</button>
          </div>
        </div>
      )}
      <div className="row" style={{ marginBottom: 8 }}><button className="primary" disabled={!editable || !dirty} onClick={save}>Save</button>{dirty && <span className="muted">Unsaved changes</span>}</div>
      <div className="editor-wrap">
        <pre className="editor editor-hl" aria-hidden="true" ref={hlRef}>{highlight(text, path).map((tk, i) => tk.t === 'plain' ? tk.s : <span key={i} className={'tk-' + tk.t}>{tk.s}</span>)}{text.endsWith('\n') ? ' ' : ''}</pre>
        <textarea className="editor editor-input" aria-label={'Contents of ' + path} value={text} readOnly={!editable}
          onScroll={(e) => { const t = e.currentTarget; if (hlRef.current) { hlRef.current.scrollTop = t.scrollTop; hlRef.current.scrollLeft = t.scrollLeft; } }}
          onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (editable && dirty) void save(); } }}
          onChange={(e) => { setText(e.target.value); setDirty(true); clearErr(); editMemory.set(editKey(path), { text: e.target.value, rev }); persistEdits(); }} />
      </div>
      <Err text={err} />
      {history.length > 0 && (
        <details className="changes">
          <summary>Change history ({history.length})</summary>
          {history.map((m) => (
            <div key={m.id} className="card" style={{ marginTop: 8 }}>
              <div className="muted">{new Date(m.at).toLocaleString()} · {m.simulated === false ? 'AI build' : 'simulated build'}{m.taskId && p.tasks.find((t) => t.id === m.taskId) ? ' · ' + p.tasks.find((t) => t.id === m.taskId)!.title : ''}</div>
              <div className="row wrap" style={{ marginTop: 6 }}>
                {m.files!.map((f) => (
                  <button key={f} className="small" onClick={() => openTab(f)}>{f}{m.diff?.[f] ? ` +${m.diff[f].added} -${m.diff[f].removed}` : ''}</button>
                ))}
              </div>
            </div>
          ))}
        </details>
      )}
      {findings.length > 0 && <div className="note">Integration check: {findings.map((f) => `${f.name} in ${f.path} is not in CONTRACT.md`).join('. ')}</div>}
    </div>
  );
}

function PreviewView({ p }: { p: ProjectView }) {
  const [nonce, setNonce] = useState(0);
  const readable = Object.keys(p.files).filter((f) => f.endsWith('index.html')).sort();
  const [sel, setSel] = useState<string | null>(null); const path = sel && readable.includes(sel) ? sel : readable[0];
  const pageRef = useRef<HTMLIFrameElement>(null);
  const beRef = useRef<HTMLIFrameElement>(null);
  const apiPath = path ? backendPathFor(path) : null;
  const apiSrc = apiPath ? p.files[apiPath] : undefined;
  // Relay between the page iframe and the feature-backend iframe (see core/preview.ts).
  useEffect(() => {
    const route = (e: MessageEvent) => {
      const d = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.__cc === 'api-req' && e.source === pageRef.current?.contentWindow) beRef.current?.contentWindow?.postMessage({ ...d, __cc: 'api-run' }, '*');
      if (d.__cc === 'api-res' && e.source === beRef.current?.contentWindow) pageRef.current?.contentWindow?.postMessage(d, '*');
    };
    window.addEventListener('message', route);
    return () => window.removeEventListener('message', route);
  }, [path, apiSrc]);
  const lb = [...(p.messages ?? [])].reverse().find((m: any) => m.kind === 'ai_build');
  const lastBuildLine = lb ? `Last build: ${new Date(lb.at).toLocaleString()} - ${lb.files?.length ?? 0} file(s) changed${lb.simulated !== false ? ' (simulated)' : ''}` : 'No builds yet.';
  if (!path) return <div className="screen"><div className="empty">Nothing to preview yet. Run a simulated build for a frontend task first.</div><div className="muted" style={{ marginTop: 8 }}>{lastBuildLine}</div></div>;
  return (
    <div className="screen">
      <div className="note">Preview of {path}: the page runs with scripts on in an opaque-origin iframe - no access to the app or its storage.{apiSrc ? ' /api calls are answered by the feature api.ts running in a second sandbox: plain-JS route modules only - no packages, no database, no other languages.' : ' No api.ts next to it, so /api calls get nothing.'} Network is otherwise not blocked. Not a secure runtime for untrusted code.</div>
      <div className="row wrap" style={{ alignItems: 'center' }}>
        {readable.length > 1 && readable.map((f) => <button key={f} className={'chip small' + (f === path ? ' on' : '')} onClick={() => setSel(f)}>{f}</button>)}
        <button className="chip small" onClick={() => setNonce((n) => n + 1)}>Refresh</button>
        <span className="muted">Runs the project's saved files, not a live deploy.</span>
        <span className="muted">{lastBuildLine}</span>
      </div>
      <iframe key={'pg' + nonce} title="Preview" sandbox="allow-scripts" srcDoc={buildPreviewDoc(p.files[path])} ref={pageRef} />
      {apiSrc && <iframe key={'be' + nonce} title="Backend runtime" sandbox="allow-scripts" srcDoc={buildBackendDoc(apiSrc)} ref={beRef} style={{ display: 'none' }} />}
    </div>
  );
}

function TasksView({ p, user, nameOf, onStatus, actOp, err }: { p: ProjectView; user: string; nameOf: (id: string) => string; onStatus: (id: string, s: TaskStatus) => void; actOp: (name: string, args: Record<string, unknown>) => Promise<any>; err: string | null }) {
  const [filter, setFilter] = useState<'all' | 'mine' | 'todo' | 'in_progress' | 'done'>('all');
  const shown = p.tasks.filter((t) => filter === 'all' ? true : filter === 'mine' ? t.assigneeId === user : t.status === filter);
  const doneCount = p.tasks.filter((t) => t.status === 'done').length;
  const pct = p.tasks.length ? Math.round((doneCount / p.tasks.length) * 100) : 0;
  const [mergeConflict, setMergeConflict] = useState<string | null>(null);
  const merge = async (taskId: string, force = false) => {
    const r = await actOp('acceptTaskMerge', { projectId: p.id, taskId, force });
    if (r?.ok) { setMergeConflict(null); return; }
    if (r && !r.ok && typeof r.error === 'string' && r.error.includes('was changed after the last merge')) setMergeConflict(taskId);
  };
  const reviewLabel = (t: ProjectView['tasks'][number]) => {
    const r = t.review;
    if (!r) return null;
    if (r.state === 'accepted') return <div className="muted" style={{ marginTop: 8 }}>Merged into main/{t.folder} - the owner sees it in the main folder.</div>;
    if (r.state === 'submitted') return <div className="muted" style={{ marginTop: 8 }}>Sent for merge review.</div>;
    if (r.state === 'ready') return <div className="muted" style={{ marginTop: 8 }}>Name check passed (shared names declared). Waiting for the owner to merge.</div>;
    return <div className="err" role="alert" style={{ marginTop: 8 }}>Changes requested: {r.findings.map((f) => `${f.name} in ${f.path}`).join(', ')} - not in CONTRACT.md</div>;
  };
  return (
    <div className="screen">
      {p.role !== 'owner' && <div className="note">You see only your own tasks.</div>}
      <Err text={err} />
      {p.role === 'owner' && p.tasks.length > 0 && (
        <div className="card">
          <strong>Integration review</strong>
          <p className="muted">A teammate submits a done task for merge. You run the contract check, then merge. The check is a name check only: it verifies that every @shared name used in the folder is declared in CONTRACT.md. It does not verify that interfaces actually match across files. Open mismatches or any edit after the check block the merge.</p>
          {p.tasks.every((t) => !t.review) && <div className="muted">Nothing submitted for merge yet.</div>}
          {p.tasks.filter((t) => t.review).map((t) => {
            const r = t.review!;
            const stale = r.state === 'ready' && r.fingerprint !== reviewFingerprint(p.fileRevs ?? {}, t.folder);
            return (
              <div key={t.id} style={{ marginTop: 8 }}>
                <div className="row spread"><strong>{t.folder}</strong><span className="tag">{r.state === 'accepted' ? 'merged' : stale ? 'check is stale' : r.state.replace('_', ' ')}</span></div>
                <div className="muted">{t.title} - {nameOf(t.assigneeId)}</div>
                {r.state === 'changes_requested' && <div className="err" role="alert">{r.findings.map((f) => `${f.name} in ${f.path}`).join(', ')} - not in CONTRACT.md</div>}
                {stale && <div className="err" role="alert">The folder changed since the last check. Run it again before merging.</div>}
                {mergeConflict === t.id && (
                  <div className="err" role="alert">The merged copy in main/ was changed after the last merge. It was kept. Overwrite it only if this merge should replace those edits.
                    <div className="row" style={{ marginTop: 8 }}><button className="small danger" onClick={() => merge(t.id, true)}>Overwrite the main copy</button></div>
                  </div>
                )}
                {r.state !== 'accepted' && (
                  <div className="row wrap" style={{ marginTop: 8 }}>
                    <button className="small" onClick={() => actOp('runIntegrationReview', { projectId: p.id, taskId: t.id })}>Run check</button>
                    <button className="small primary" disabled={r.state !== 'ready' || stale} onClick={() => merge(t.id)}>Merge into main</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {p.tasks.length > 0 && (
        <div className="card">
          <div className="row spread"><strong>Progress</strong><span className="muted">{doneCount} of {p.tasks.length} done - {pct}%</span></div>
          <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div style={{ width: pct + '%' }} /></div>
        </div>
      )}
      <div className="row wrap" role="group" aria-label="Task filters">
        {([['all', 'All'], ['mine', 'Mine'], ['todo', 'To do'], ['in_progress', 'In progress'], ['done', 'Done']] as const).map(([k, label]) => (
          <button key={k} className={'chip small' + (filter === k ? ' on' : '')} onClick={() => setFilter(k)}>{label}</button>
        ))}
      </div>
      {p.tasks.length === 0 && <div className="empty">No tasks yet.</div>}
      {p.tasks.length > 0 && shown.length === 0 && <div className="empty">No tasks match this filter.</div>}
      {shown.map((t) => (
        <div key={t.id} className="card">
          <div className="row spread"><strong>{t.title}</strong><span className="tag">{t.status.replace('_', ' ')}</span></div>
          <p className="muted">{t.detail}</p>
          <div className="muted">Assigned to {nameOf(t.assigneeId)}. Folder {t.folder}</div>
          {t.deps?.length ? <div className="muted">Depends on: {t.deps.join(', ')} - merge those first.</div> : null}
          <div className="row wrap" style={{ marginTop: 8, alignItems: 'center' }}>
            <label className="muted">Priority
              <select aria-label={'Priority for ' + t.title} value={t.priority ?? ''} onChange={(e) => actOp('setTaskDetails', { projectId: p.id, taskId: t.id, priority: e.target.value || null })}>
                <option value=''>none</option><option value='low'>low</option><option value='medium'>medium</option><option value='high'>high</option>
              </select>
            </label>
            <label className="muted">Due
              <input aria-label={'Due date for ' + t.title} type='date' value={t.due ?? ''} onChange={(e) => actOp('setTaskDetails', { projectId: p.id, taskId: t.id, due: e.target.value || null })} />
            </label>
          </div>
          <details style={{ marginTop: 6 }}>
            <summary className="muted">Acceptance criteria{t.acceptance ? '' : ' (none set)'}</summary>
            <textarea aria-label={'Acceptance criteria for ' + t.title} defaultValue={t.acceptance ?? ''} placeholder='What must be true for this task to be accepted' rows={2} onBlur={(e) => { if (e.target.value !== (t.acceptance ?? '')) actOp('setTaskDetails', { projectId: p.id, taskId: t.id, acceptance: e.target.value }); }} />
          </details>
          <div className="row wrap" style={{ marginTop: 8 }}>{(['todo', 'in_progress', 'done'] as const).map((s) => <button key={s} className={'chip small' + (t.status === s ? ' on' : '')} onClick={() => onStatus(t.id, s)}>{s.replace('_', ' ')}</button>)}</div>
          {reviewLabel(t)}
          {t.status === 'done' && t.review?.state !== 'accepted' && (
            <div className="row" style={{ marginTop: 8 }}><button className="small" onClick={() => actOp('submitTaskForReview', { projectId: p.id, taskId: t.id })}>{t.review ? 'Submit again for merge' : 'Submit for merge'}</button></div>
          )}
        </div>
      ))}
    </div>
  );
}

function TeamSheet({ p, user, nameOf, actOp, close, err, backupJson, setBackupJson, inline }: { p: ProjectView; user: string; nameOf: (id: string) => string; actOp: (name: string, args: Record<string, unknown>) => Promise<any>; close: () => void; err: string | null; backupJson: string; setBackupJson: (v: string) => void; inline?: boolean }) {
  const owner = p.role === 'owner';
  const inner = (
    <>
      <div className="row spread"><h2 style={{ margin: 0 }}>Team</h2>{!inline && <button className="small" onClick={close}>Close</button>}</div>
      <Err text={err} />
      {owner && <div className="card"><div className="muted">Team code{p.teamRevoked ? ' (turned off)' : ''}</div><div className="row spread"><div className="code">{p.teamCode}</div><CopyBtn text={p.teamCode ?? ''} /></div>
        {!p.teamRevoked && (p.teamExpiresAt == null
          ? <div className="muted">No expiry set.</div>
          : Date.now() > p.teamExpiresAt
            ? <div className="err" role="alert">This code expired on {new Date(p.teamExpiresAt).toLocaleDateString()}. Teammates cannot join with it. Make a new code to reopen joining.</div>
            : <div className="muted">This code expires on {new Date(p.teamExpiresAt).toLocaleDateString()}.</div>)}
        {!p.teamRevoked && <div className="row wrap" style={{ marginTop: 8 }}><span className="muted">Expiry:</span>
          <button className="small" onClick={() => actOp('setTeamCodeExpiry', { projectId: p.id, days: null })}>No expiry</button>
          <button className="small" onClick={() => actOp('setTeamCodeExpiry', { projectId: p.id, days: 1 })}>1 day</button>
          <button className="small" onClick={() => actOp('setTeamCodeExpiry', { projectId: p.id, days: 7 })}>7 days</button>
          <button className="small" onClick={() => actOp('setTeamCodeExpiry', { projectId: p.id, days: 30 })}>30 days</button></div>}
        {!p.teamRevoked && <div className="muted" style={{ marginTop: 8 }}>Joins with this code: {p.teamJoinsUsed ?? 0}{p.teamMaxJoins != null ? ` (limit ${p.teamMaxJoins})` : ' (no limit)'}{p.teamMaxJoins != null && (p.teamJoinsUsed ?? 0) >= p.teamMaxJoins ? ' - limit reached, joining is closed' : ''}</div>}
        {!p.teamRevoked && <div className="row wrap" style={{ marginTop: 4 }}><span className="muted">Join limit:</span>
          <button className="small" onClick={() => actOp('setTeamJoinLimit', { projectId: p.id, maxJoins: null })}>No limit</button>
          <button className="small" onClick={() => actOp('setTeamJoinLimit', { projectId: p.id, maxJoins: 1 })}>1</button>
          <button className="small" onClick={() => actOp('setTeamJoinLimit', { projectId: p.id, maxJoins: 5 })}>5</button>
          <button className="small" onClick={() => actOp('setTeamJoinLimit', { projectId: p.id, maxJoins: 10 })}>10</button></div>}
        <div className="row wrap" style={{ marginTop: 8 }}><button className="small" onClick={() => actOp('regenerateCode', { projectId: p.id })}>New code</button><button className="small danger" onClick={() => actOp('revokeCode', { projectId: p.id })} disabled={!!p.teamRevoked}>Turn off</button></div></div>}
      {p.members.map((m) => (
        <div key={m.userId} className="card"><div className="row spread"><strong>{nameOf(m.userId)}</strong><span className={'tag ' + m.role}>{m.role}</span></div>
          <div className="muted">{m.interests.length ? m.interests.join(', ') : 'No interests listed'}</div>
          {owner && m.role !== 'owner' && <button className="small danger" style={{ marginTop: 8 }} onClick={() => actOp('removeMember', { projectId: p.id, targetId: m.userId })}>Remove</button>}
        </div>
      ))}
      {owner && <div className="card"><strong>Backup</strong><p className="muted">Owner only. Export downloads a JSON snapshot. Restoring replaces the whole project; open editors on older versions will conflict loudly.</p>
        <div className="row spread" style={{ marginTop: 4 }}><div className="grow"><strong>Google Drive backup</strong><div className="muted">Paused: project storage is moving to GitHub instead. Drive backup is not connected and this control stays off.</div></div>
          <span className="tag">{driveStatus({}).configured ? 'configured' : 'not connected'}</span></div>
        <p className="muted">{driveStatus({}).reason ?? ''}</p>
        <div className="row wrap" style={{ marginTop: 4 }}>
          <button className="small" disabled={!driveStatus({}).configured} title={driveStatus({}).reason}>Save backup to Google Drive</button>
        </div>
        <div className="row wrap" style={{ marginTop: 8 }}>
          <button className="small" onClick={async () => { const r = await actOp('exportProject', { projectId: p.id }); if (r?.ok) setBackupJson(r.data.json); }}>Export</button>
        </div>
        {backupJson && <>
          <textarea aria-label="Backup JSON" style={{ marginTop: 8, minHeight: 90 }} value={backupJson} onChange={(e) => setBackupJson(e.target.value)} />
          <div className="row wrap" style={{ marginTop: 8 }}>
            <CopyBtn text={backupJson} />
            <button className="small danger" onClick={async () => { const r = await actOp('restoreProject', { json: backupJson }); if (r?.ok) setBackupJson(''); }}>Restore this backup</button>
          </div>
        </>}
      </div>}
      {owner && <div className="card"><div className="row spread"><div className="grow"><strong>Share my AI model</strong><div className="muted">Not available yet: there is no relay that lets teammates run builds on the owner's key, so this stays off. Teammates add their own key under AI access.</div></div>
        <button className="chip" disabled title="Not implemented yet">Unavailable</button></div></div>}
    </>
  );
  if (inline) return <div className="screen">{inner}</div>;
  return <div className="sheet-bg" onClick={close}><div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Team">{inner}</div></div>;
}

function FilesView({ p }: { p: ProjectView }) {
  const ROOT_DOCS = ['PRD.md', 'AGENT_INSTRUCTIONS.md', 'CONTRACT.md'];
  const paths = Object.keys(p.files).sort((a, b) => (ROOT_DOCS.includes(b) ? 1 : 0) - (ROOT_DOCS.includes(a) ? 1 : 0) || a.localeCompare(b));
  const [sel, setSel] = useState<string | null>(null);
  const cur = sel && p.files[sel] != null ? sel : paths[0];
  if (!cur) return <div className="screen"><div className="empty">No files yet.</div></div>;
  return (
    <div className="screen">
      <div className="muted">Project documents and source files. Edit them in the Code tab.</div>
      <div className="files">{paths.map((f) => (
        <button key={f} className={'chip small' + (f === cur ? ' on' : '')} onClick={() => setSel(f)}>{ROOT_DOCS.includes(f) ? '[doc] ' : ''}{f}</button>
      ))}</div>
      <div className="card"><div className="row spread"><strong style={{ overflowWrap: 'anywhere' }}>{cur}</strong><span className="muted">{p.files[cur].split('\n').length} lines</span></div>
        <pre className="docview">{p.files[cur]}</pre></div>
    </div>
  );
}

function SettingsView({ p, me, go, actOp }: { p: ProjectView; me: Me; go: (s: Screen) => void; actOp: (n: string, a: Record<string, unknown>) => Promise<any> }) {
  const owner = p.role === 'owner';
  const mine = p.members.find((m) => m.userId === me.id);
  const ai = mine?.ai;
  return (
    <div className="screen">
      <h2>Settings</h2>
      <div className="card">
        <strong>Project</strong>
        <div className="muted" style={{ marginTop: 6 }}>{p.name} - your role: {p.role}</div>
        <div className="muted">{p.summary && p.summary !== p.name ? p.summary : 'No description yet'}</div>
      </div>
      <div className="card">
        <strong>AI access</strong>
        <div className="muted" style={{ marginTop: 6 }}>{ai?.kind === 'own' ? `Your ${ai.provider} key` : ai?.kind === 'owner' ? "Owner's model" : 'None - simulated builds until a key is added'}</div>
        <div className="row" style={{ marginTop: 8 }}><button className="small" onClick={() => go({ name: 'ai', pid: p.id })}>Configure AI access</button></div>
        <div className="muted" style={{ marginTop: 6 }}>Provider keys are stored only in this browser, never sent to teammates.</div>
      </div>
      {owner && <div className="card"><div className="row spread"><div className="grow"><strong>Share my AI model</strong><div className="muted">Not available yet: there is no relay that lets teammates run builds on the owner's key, so this stays off. Teammates add their own key under AI access.</div></div>
        <button className="chip" disabled title="Not implemented yet">Unavailable</button></div></div>}
      <div className="card">
        <strong>Sign-in</strong>
        <GithubSignIn />
      </div>
    </div>
  );}

// Real GitHub OAuth, gated on what the server actually reports: the button is
// live only when the server says its client id/secret are configured. Anything
// else is shown as unavailable, never as a working sign-in.
function GithubSignIn() {
  const [state, setState] = useState<'checking' | 'configured' | 'unavailable'>('checking'); const [storageReady, setStorageReady] = useState(false);
  const [session, setSession] = useState<string | null>(null);
  const check = () => {
    fetch('/api/auth/status').then((r) => r.json()).then((d) => {
      setState(d && d.githubSignIn === 'configured' ? 'configured' : 'unavailable'); setStorageReady(!!d && d.storage !== 'not-configured');
      setSession(d && d.session ? String(d.session.githubLogin) : null);
    }).catch(() => { setState('unavailable'); setSession(null); });
  };
  useEffect(() => { check(); }, []);
  const logout = async () => { try { await fetch('/api/auth/logout', { method: 'POST' }); } catch { /* offline */ } check(); };
  return (
    <div style={{ marginTop: 6 }}>
      {session ? (
        <>
          <div className="muted">Signed in with GitHub as {session}. Your actions now use that account; test identities stay available for demos.</div>
          <div className="row" style={{ marginTop: 8 }}><button className="chip" onClick={logout}>Log out of GitHub</button></div>
        </>
      ) : (
        <>
          <div className="muted">Test identities only right now. GitHub sign-in is wired on the server but not yet verified end-to-end with GitHub.</div>
          {state === 'checking' && <div className="muted" style={{ marginTop: 6 }}>Checking the server...</div>}
          {state === 'configured' && storageReady && <div className="row" style={{ marginTop: 8 }}><a className="chip" href="/api/auth/github">Sign in with GitHub</a></div>}
          {state === 'configured' && !storageReady && <div className="muted" style={{ marginTop: 8 }}>GitHub sign-in is being set up: durable storage is not configured on this deployment yet.</div>}
          {state === 'unavailable' && <div className="row" style={{ marginTop: 8 }}><button className="chip" disabled title="The dev server has no GitHub client configured">Not connected</button></div>}
        </>
      )}
    </div>
  );
}



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
      <div className="note">Starter catalog: the named tools mapped to what they really are. {CATALOG.filter(localRunnable).map((i) => i.label).join(', ')} run locally, only inside your folder scope. Items needing more than local reads say what they need.</div>
      <input aria-label="Search catalog" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" />
      <Err text={err} />
      {output && <div className="note" role="status">{output}</div>}
      {items.length === 0 && <div className="empty">Nothing matches "{q}".</div>}
      {items.map((it) => {
        const added = p.skills.find((s) => s.id === it.id);
        return (
          <div key={it.id} className="card"><div className="row spread"><strong>{it.label}</strong><span className="tag">{it.hosted ? 'hosted' : it.kind}</span></div>
            <p className="muted">{it.summary}</p>
            <div className="muted">Permissions: {it.permissions.join('; ')}</div>
            <div className="row wrap" style={{ marginTop: 8 }}>
              {!added && !it.hosted && <button className="small primary" onClick={() => actOp('addSkill', { projectId: pid, skillId: it.id })}>Add</button>}
              {it.hosted && <span className="tag">hosted in Claude - not addable in this build</span>}
              {added && <span className="tag">{added.approvedByOwner ? 'approved' : 'waiting for owner'}</span>}
              {added && !added.approvedByOwner && owner && <button className="small" onClick={() => actOp('approveSkill', { projectId: pid, skillId: it.id })}>Approve</button>}
              {added && (owner || added.addedBy === user) && <button className="small danger" onClick={() => { setOutput(null); actOp('removeSkill', { projectId: pid, skillId: it.id }); }}>Remove</button>}
            </div>
            {added && added.approvedByOwner && localRunnable(it) && (
              <div className="row" style={{ marginTop: 8 }}>
                <input aria-label={`File for ${it.label}`} placeholder="file path, e.g. home/index.html" value={runPath[it.id] ?? ''} onChange={(e) => setRunPath({ ...runPath, [it.id]: e.target.value })} />
                <button className="small primary" onClick={() => run(it.id)}>Run</button>
              </div>
            )}
            {added && added.approvedByOwner && !localRunnable(it) && <div className="muted" style={{ marginTop: 8 }}>Cannot run yet in this build{it.caps.some((c) => c !== 'read_scope') ? ': needs ' + it.caps.filter((c) => c !== 'read_scope').join(', ') : ''}.</div>}
          </div>
        );
      })}
      <div className="muted">{CATALOG.length} items in the starter set.</div>
    </div></div>
  );
}

// Discover: the browsable catalogue behind the rail item. Same honest data as
// the project's tools sheet, grouped into the three brief categories. Browse
// only - adding stays project-scoped in the tools sheet beside the composer.
// Nothing here is a live external connection; each card says what it really is.
function DiscoverView() {
  const [q, setQ] = useState('');
  const items = useMemo(() => searchCatalog(q), [q]);
  const groups: { key: string; title: string; match: (i: SkillItem) => boolean }[] = [
    { key: 'skill', title: 'Skills', match: (i) => i.kind === 'skill' && !i.hosted },
    { key: 'mcp', title: 'MCP servers', match: (i) => i.kind === 'mcp' && !i.hosted },
    { key: 'prebuilt', title: 'Open-source prebuilt components', match: (i) => i.kind === 'prebuilt' && !i.hosted },
    { key: 'hosted', title: 'Hosted services (not open-source, not installable here)', match: (i) => !!i.hosted },
  ];
  const stateTag = (it: SkillItem) => it.hosted ? 'Hosted service - information only' : localRunnable(it) ? 'Runs locally in this build' : 'Needs a connection - not available in this build';
  return (
    <div className="screen">
      <h2>Discover</h2>
      <div className="note">The starter catalogue. Every item says what it really is: local tools run here, everything else is labelled with what it would need. Nothing on this page is a live external connection - adding a tool to a project happens from the tools button beside the chat composer.</div>
      <input aria-label="Search Discover catalogue" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search skills, MCP servers, prebuilt" />
      {groups.map((g) => {
        const list = items.filter(g.match);
        if (list.length === 0) return null;
        return (
          <div key={g.key}>
            <h3>{g.title}</h3>
            {list.map((it) => (
              <div key={it.id} className="card">
                <div className="row spread"><strong>{it.label}</strong><span className="tag">{stateTag(it)}</span></div>
                <p className="muted">{it.summary}</p>
                <div className="muted">Requested access: {it.permissions.join('; ')}</div>
                <div className="muted" style={{ marginTop: 6 }}>{it.hosted || !localRunnable(it) ? 'Cannot be enabled in this build.' : 'Can be added to a project from the chat tools sheet.'}</div>
              </div>
            ))}
          </div>
        );
      })}
      {items.length === 0 && <div className="empty">Nothing matches "{q}".</div>}
    </div>
  );
        }
