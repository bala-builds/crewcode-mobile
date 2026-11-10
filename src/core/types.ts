export type Role = 'owner' | 'teammate';
export type ProviderLabel = 'Gemini' | 'NVIDIA' | 'Grok' | 'Claude' | 'GPT';
export const PROVIDER_LABELS: ProviderLabel[] = ['Gemini', 'NVIDIA', 'Grok', 'Claude', 'GPT'];

/** Test identity only. This is NOT a login. Real authentication is the last phase. */
export interface TestUser { id: string; name: string;
  // Set only for accounts created through real GitHub sign-in. githubId is the
  // immutable GitHub user id - the durable identity binding; the login can change.
  githubId?: number; githubLogin?: string }

export interface AiAccess {
  kind: 'owner' | 'own';
  provider?: ProviderLabel; // set for own keys, and for the owner's own key on the owner model
  // Keys themselves are never stored here. See providers.ts keyring (memory only).
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
  /** Folders this feature depends on; merge is refused until every one is itself merged. */
  deps?: string[];
  status: TaskStatus;
  /** Optional planning metadata (brief: priority, due dates, acceptance criteria). */
  priority?: 'low' | 'medium' | 'high';
  due?: string; // ISO date YYYY-MM-DD
  acceptance?: string;
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
  /** Per-file line counts for an ai_build message (prefix/suffix-trim diff vs the previous content). */
  diff?: Record<string, { added: number; removed: number }>;
  /** false only for messages produced by a real provider call; simulated is the default */
  simulated?: boolean;
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
  /** Plan awaiting the owner's review. Tasks are created only when the owner approves it. */
  proposedPlan?: import('./orchestrator').PlannedTask[];
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
