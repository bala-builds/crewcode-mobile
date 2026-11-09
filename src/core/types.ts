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
export interface Task {
  id: string;
  title: string;
  detail: string;
  assigneeId: string;
  folder: string; // e.g. "frontend/"
  status: TaskStatus;
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
  team: { code: string; revoked: boolean; expiresAt: number | null };
  members: Member[];
  files: Record<string, string>; // path -> content. Root holds PRD.md, AGENT_INSTRUCTIONS.md, CONTRACT.md
  tasks: Task[];
  messages: ChatMessage[];
  ownerKeySharing: boolean;
  skills: ProjectSkill[];
}

export interface ProjectSkill { id: string; approvedByOwner: boolean; addedBy: string }

export interface AppState {
  users: TestUser[];
  projects: Project[];
  currentUserId: string | null;
}

export const ROOT_FILES = ['PRD.md', 'AGENT_INSTRUCTIONS.md', 'CONTRACT.md'] as const;
