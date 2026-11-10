export type Role = 'owner' | 'teammate';
export type ProviderLabel = 'Gemini' | 'NVIDIA' | 'Grok' | 'Claude' | 'GPT';
export const PROVIDER_LABELS: ProviderLabel[] = ['Gemini', 'NVIDIA', 'Grok', 'Claude', 'GPT'];

/** Test identity only. This is NOT a login. Real authentication is the last phase. */
export interface TestUser { id: string; name: string }

export interface AiAccess {
  kind: 'owner' | 'own';
  provider?: ProviderLabel; // only for own
  // An own key is never stored here. See keyring.ts (memory only).
}

export interface Member {
  userId: string;
  role: Role;
  interests: string[];
  ai?: AiAccess;
}

export type TaskStatus = 'todo' | 'in_progress' | 'done';
export type TaskRun = 'idle' | 'thinking' | 'failed';
export type ReviewState = 'submitted' | 'ready' | 'changes_requested' | 'accepted';
/**
 * Owner merge review of a task folder (PRD F6). No review record means the work is a
 * draft: it is not merged and does not count toward the project. 'accepted' means merged.
 */
export interface TaskReview {
  state: ReviewState;
  findings: { path: string; name: string }[];
  /** Folder fingerprint (path@rev pairs) plus the CONTRACT.md revision at the last check. A merge is refused once it no longer matches. */
  fingerprint: string;
  at: number;
  /** Immutable copy of the folder exactly as merged (set on acceptance). Later edits reopen the review. */
  snapshot?: Record<string, string>;
  /** Content written into main/<path> at the last acceptance. A later change to a merged copy blocks the next merge unless the owner explicitly overwrites it - merged work is never silently replaced. */
  merged?: Record<string, string>;
}
export interface Task {
  id: string;
  title: string;
  detail: string;
  assigneeId: string;
  folder: string; // e.g. "frontend/"
  status: TaskStatus;
  run?: TaskRun;
  runError?: string;
  review?: TaskReview;
}

export interface ChatMessage {
  id: string;
  authorId: string | 'ai';
  /** which task thread this message belongs to; null means the owner's project thread */
  taskId: string | null;
  kind: 'prompt' | 'ai_plan' | 'ai_build' | 'ai_error' | 'system';
  text: string;
  files?: string[]; // paths touched by an ai_build message
  at: number;
}

export interface Project {
  id: string;
  name: string;
  ownerId: string;
  team: { code: string; revoked: boolean; expiresAt: number | null; maxJoins?: number | null; joinsUsed?: number };
  members: Member[];
  files: Record<string, string>; // path -> content. Root holds PRD.md, AGENT_INSTRUCTIONS.md, CONTRACT.md
  fileRevs: Record<string, number>; // path -> revision, bumped on every write; the base of optimistic conflict checks
  tasks: Task[];
  messages: ChatMessage[];
  ownerKeySharing: boolean;
  /** true while the owner's AI is dividing tasks; a late provider result is discarded once cleared */
  planning?: boolean;
  skills: ProjectSkill[];
}

export interface ProjectSkill { id: string; approvedByOwner: boolean; addedBy: string }

export interface AppState {
  users: TestUser[];
  projects: Project[];
  currentUserId: string | null;
  /** Mutation counter, bumped by the server on every committed change; clients poll it to see each other's work. */
  version?: number;
}

export const ROOT_FILES = ['PRD.md', 'AGENT_INSTRUCTIONS.md', 'CONTRACT.md'] as const;
