// Server-side API layer. Every call names a caller (a TEST identity until Phase 10 auth exists)
// and the server returns only what that caller may see. The client is never trusted to filter.
import type { AppState, Project } from '../core/types';
import * as S from '../core/store';
import { visibleFiles, visibleMessages, visibleTasks, visibleMembers, isMember, isOwner } from '../core/permissions';

export type ApiRequest = { as: string; op: string; args?: Record<string, any> };
export type ApiResponse = { ok: true; data?: any } | { ok: false; error: string };

export type ProjectView = {
  id: string; name: string; role: 'owner' | 'teammate'; ownerKeySharing: boolean;
  teamCode?: string; files: Record<string, string>; tasks: ReturnType<typeof visibleTasks>;
  messages: ReturnType<typeof visibleMessages>; members: ReturnType<typeof visibleMembers>;
};

export function viewFor(p: Project, userId: string): ProjectView {
  const files: Record<string, string> = {};
  for (const f of visibleFiles(p, userId)) files[f] = p.files[f];
  return {
    id: p.id, name: p.name, role: isOwner(p, userId) ? 'owner' : 'teammate', ownerKeySharing: p.ownerKeySharing,
    teamCode: isOwner(p, userId) ? p.team.code : undefined, // teammates never receive the code
    files, tasks: visibleTasks(p, userId), messages: visibleMessages(p, userId), members: visibleMembers(p, userId),
  };
}

export class Api {
  constructor(public state: AppState = S.seedState(), private persist: (s: AppState) => void = () => {}) {}

  private commit(r: S.Result<any>): ApiResponse {
    if (!r.ok) return { ok: false, error: r.error };
    this.state = r.state; this.persist(this.state); return { ok: true };
  }

  call(req: ApiRequest): ApiResponse {
    const { as: u, op, args = {} } = req;
    if (!this.state.users.some((x) => x.id === u)) return { ok: false, error: 'Unknown test identity.' };
    const st = this.state;
    switch (op) {
      case 'listProjects':
        return { ok: true, data: st.projects.filter((p) => isMember(p, u)).map((p) => viewFor(p, u)) };
      case 'getProject': {
        const p = st.projects.find((x) => x.id === args.projectId);
        // Same answer for "missing" and "not yours" so ids cannot be probed.
        if (!p || !isMember(p, u)) return { ok: false, error: 'Project not found.' };
        return { ok: true, data: viewFor(p, u) };
      }
      case 'createProject': {
        const r = S.createProject(st, u, args.name, args.prd ?? '', args.instructions ?? '');
        const out = this.commit(r); return out.ok && r.ok ? { ok: true, data: { projectId: r.projectId } } : out;
      }
      case 'joinProject': {
        const r = S.joinProject(st, u, args.code ?? '', args.interests ?? []);
        const out = this.commit(r); return out.ok && r.ok ? { ok: true, data: { projectId: r.projectId } } : out;
      }
      case 'saveFile': return this.commit(S.saveFile(st, args.projectId, u, args.path, args.content));
      case 'postPrompt': return this.commit(S.postPrompt(st, args.projectId, u, args.text, args.taskId ?? null));
      case 'assignTasks': return this.commit(S.assignTasks(st, args.projectId, u));
      case 'runBuild': return this.commit(S.runBuild(st, args.projectId, u, args.taskId, { forceError: !!args.forceError }));
      case 'setTaskStatus': return this.commit(S.setTaskStatus(st, args.projectId, u, args.taskId, args.status));
      case 'setAiAccess': return this.commit(S.setAiAccess(st, args.projectId, u, args.access));
      case 'setOwnerKeySharing': return this.commit(S.setOwnerKeySharing(st, args.projectId, u, !!args.on));
      case 'regenerateCode': return this.commit(S.regenerateCode(st, args.projectId, u));
      case 'revokeCode': return this.commit(S.revokeCode(st, args.projectId, u));
      case 'removeMember': return this.commit(S.removeMember(st, args.projectId, u, args.targetId));
      default: return { ok: false, error: 'Unknown operation.' };
    }
  }
}
