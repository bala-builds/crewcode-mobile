// Server-side API layer. Every call names a caller (a TEST identity until Phase 10 auth exists)
// and the server returns only what that caller may see. The client is never trusted to filter.
import type { AppState, Project } from '../core/types';
import * as S from '../core/store';
import { visibleFiles, visibleMessages, visibleTasks, visibleMembers, isMember, isOwner } from '../core/permissions';
import { exportProject, restoreProject } from '../core/backup';
import { deterministicBuild } from '../core/execution';

export type ApiRequest = { as: string; op: string; args?: Record<string, any> };
export type ApiResponse = { ok: true; data?: any } | { ok: false; error: string };

export type ProjectView = {
  id: string; name: string; role: 'owner' | 'teammate'; ownerKeySharing: boolean;
  teamCode?: string; teamRevoked?: boolean; teamExpiresAt?: number | null; teamMaxJoins?: number | null; teamJoinsUsed?: number; files: Record<string, string>; fileRevs: Record<string, number>;
  tasks: ReturnType<typeof visibleTasks>;
  messages: ReturnType<typeof visibleMessages>; members: ReturnType<typeof visibleMembers>;
  skills: Project['skills'];
  names: Record<string, string>; // display names for member ids; test identities only until Phase 10
};

export function viewFor(p: Project, userId: string, users: { id: string; name: string }[] = []): ProjectView {
  const files: Record<string, string> = {};
  const fileRevs: Record<string, number> = {};
  for (const f of visibleFiles(p, userId)) { files[f] = p.files[f]; fileRevs[f] = p.fileRevs?.[f] ?? 0; }
  const owner = isOwner(p, userId);
  return {
    id: p.id, name: p.name, role: owner ? 'owner' : 'teammate', ownerKeySharing: p.ownerKeySharing,
    teamCode: owner ? p.team.code : undefined, // teammates never receive the code
    teamRevoked: owner ? p.team.revoked : undefined,
    teamExpiresAt: owner ? p.team.expiresAt : undefined, // teammates never learn code state
    teamMaxJoins: owner ? p.team.maxJoins ?? null : undefined,
    teamJoinsUsed: owner ? p.team.joinsUsed ?? 0 : undefined,
    files, fileRevs, tasks: visibleTasks(p, userId), messages: visibleMessages(p, userId), members: visibleMembers(p, userId),
    skills: p.skills,
    names: Object.fromEntries(p.members.map((m) => [m.userId, users.find((u) => u.id === m.userId)?.name ?? m.userId])),
  };
}

function requireDeterministicBuild(projectName: string, folder: string, prompt: string): { ok: true; message: string; files: Record<string, string> } | { ok: false; error: string } {
  // The local server is synchronous and intentionally uses only the deterministic provider.
  return deterministicBuild(projectName, folder, prompt);
}

export type AsyncBuildProvider = (task: import('../core/types').Task, project: { name: string; files: Record<string, string> }, prompt: string) => Promise<{ ok: true; message: string; files: Record<string, string> } | { ok: false; error: string }>;

export class Api {
  constructor(
    public state: AppState = S.seedState(),
    private persist: (s: AppState) => void = () => {},
    // The build provider is injectable so tests can delay or fail it. The default is the
    // deterministic local provider; a live provider stays approval-gated and is not wired here.
    private buildProvider: AsyncBuildProvider = async (t, pr, prompt) => deterministicBuild(pr.name, t.folder, prompt),
  ) {}

  /**
   * Async boundary for task runs (used by the HTTP server): start marks the task thinking,
   * the provider runs, and apply commits only if the task was not stopped meanwhile.
   * A stopped run discards the provider result entirely - no late writes, no build message.
   */
  async callAsync(req: ApiRequest): Promise<ApiResponse> {
    if (req.op !== 'runBuild') return this.call(req);
    const { as: u, args = {} } = req;
    if (!this.state.users.some((x) => x.id === u)) return { ok: false, error: 'Unknown test identity.' };
    const started = S.startTaskRun(this.state, args.projectId, u, args.taskId);
    if (!started.ok) return { ok: false, error: started.error };
    this.state = started.state; this.persist(this.state);
    let result: Awaited<ReturnType<AsyncBuildProvider>>;
    if (args.forceError) {
      result = { ok: false, error: 'Simulated error. Nothing was changed. You can retry.' };
    } else {
      const p = this.state.projects.find((x) => x.id === args.projectId)!;
      const t = p.tasks.find((x) => x.id === args.taskId)!;
      try {
        result = await this.buildProvider(t, { name: p.name, files: p.files }, typeof args.prompt === 'string' ? args.prompt : '');
      } catch {
        result = { ok: false, error: 'The provider could not be reached.' };
      }
    }
    const applied = S.applyTaskRun(this.state, args.projectId, args.taskId, result, { simulated: true });
    if (!applied.ok) return { ok: false, error: applied.error };
    this.state = applied.state; this.persist(this.state);
    return { ok: true, data: { discarded: !!applied.discarded } };
  }

  private commit(r: S.Result<any>): ApiResponse {
    if (!r.ok) return { ok: false, error: r.error };
    this.state = r.state; this.persist(this.state); return { ok: true };
  }

  call(req: ApiRequest): ApiResponse {
    const { as: u, op, args = {} } = req;
    if (!this.state.users.some((x) => x.id === u)) return { ok: false, error: 'Unknown test identity.' };
    const st = this.state;
    switch (op) {
      case 'listUsers':
        // Test identities are not secrets; real accounts arrive with Phase 10 auth.
        return { ok: true, data: st.users.map((x) => ({ id: x.id, name: x.name })) };
      case 'registerName': {
        const r = S.registerName(st, args.name ?? '');
        const out = this.commit(r); return out.ok && r.ok ? { ok: true, data: { userId: r.userId } } : out;
      }
      case 'listProjects':
        return { ok: true, data: st.projects.filter((p) => isMember(p, u)).map((p) => viewFor(p, u, st.users)) };
      case 'getProject': {
        const p = st.projects.find((x) => x.id === args.projectId);
        // Same answer for "missing" and "not yours" so ids cannot be probed.
        if (!p || !isMember(p, u)) return { ok: false, error: 'Project not found.' };
        return { ok: true, data: viewFor(p, u, st.users) };
      }
      case 'createProject': {
        const r = S.createProject(st, u, args.name, args.prd ?? '', args.instructions ?? '');
        const out = this.commit(r); return out.ok && r.ok ? { ok: true, data: { projectId: r.projectId } } : out;
      }
      case 'joinProject': {
        const r = S.joinProject(st, u, args.code ?? '', args.interests ?? []);
        const out = this.commit(r); return out.ok && r.ok ? { ok: true, data: { projectId: r.projectId } } : out;
      }
      case 'saveFile': return this.commit(S.saveFile(st, args.projectId, u, args.path, args.content, args.baseRev));
      case 'postPrompt': return this.commit(S.postPrompt(st, args.projectId, u, args.text, args.taskId ?? null));
      case 'assignTasks': return this.commit(S.assignTasks(st, args.projectId, u));
      case 'runBuild': {
        // The local server is synchronous: the client starts a run, and this request finishes it.
        const r = S.runBuild(st, args.projectId, u, args.taskId, {
          forceError: !!args.forceError,
          prompt: typeof args.prompt === 'string' ? args.prompt : '',
          simulated: true,
          build: (task, project, prompt) => requireDeterministicBuild(project.name, task.folder, prompt),
        });
        return this.commit(r);
      }
      case 'cancelTaskRun': return this.commit(S.cancelTaskRun(st, args.projectId, u, args.taskId));
      case 'setTaskStatus': return this.commit(S.setTaskStatus(st, args.projectId, u, args.taskId, args.status));
      case 'submitTaskForReview': return this.commit(S.submitTaskForReview(st, args.projectId, u, args.taskId));
      case 'runIntegrationReview': return this.commit(S.runIntegrationReview(st, args.projectId, u, args.taskId));
      case 'acceptTaskMerge': return this.commit(S.acceptTaskMerge(st, args.projectId, u, args.taskId));
      case 'setAiAccess': return this.commit(S.setAiAccess(st, args.projectId, u, args.access));
      case 'setOwnerKeySharing': return this.commit(S.setOwnerKeySharing(st, args.projectId, u, !!args.on));
      case 'regenerateCode': return this.commit(S.regenerateCode(st, args.projectId, u));
      case 'setTeamCodeExpiry': return this.commit(S.setTeamCodeExpiry(st, args.projectId, u, args.days ?? null));
      case 'setTeamJoinLimit': return this.commit(S.setTeamJoinLimit(st, args.projectId, u, args.maxJoins ?? null));
      case 'revokeCode': return this.commit(S.revokeCode(st, args.projectId, u));
      case 'removeMember': return this.commit(S.removeMember(st, args.projectId, u, args.targetId));
      case 'addSkill': return this.commit(S.addSkill(st, args.projectId, u, args.skillId));
      case 'approveSkill': return this.commit(S.approveSkill(st, args.projectId, u, args.skillId));
      case 'removeSkill': return this.commit(S.removeSkill(st, args.projectId, u, args.skillId));
      case 'runSkill': {
        const r = S.runSkill(st, args.projectId, u, args.skillId, args.path ?? '');
        const out = this.commit(r); return out.ok && r.ok ? { ok: true, data: { output: r.output } } : out;
      }
      case 'exportProject': {
        const r = exportProject(st, args.projectId, u);
        return r.ok ? { ok: true, data: { json: r.json } } : { ok: false, error: r.error };
      }
      case 'restoreProject': {
        const r = restoreProject(st, u, args.json ?? '');
        const out = this.commit(r); return out.ok && r.ok ? { ok: true, data: { projectId: r.projectId } } : out;
      }
      default: return { ok: false, error: 'Unknown operation.' };
    }
  }
}
