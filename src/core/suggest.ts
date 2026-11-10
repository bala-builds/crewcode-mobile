// Command-suggestion proposals (e.g. from a local Needle sidecar).
// A proposal is NEVER executed by the suggestion path itself: it is validated,
// shown to the user, and only runs if the user explicitly clicks Run, which goes
// through the normal actOp path with all existing owner/permission gates.
// The model proposing an argument (e.g. accept=false on "approve") changes nothing:
// validation only checks SHAPE; the user confirms the actual call.

export type ProposedCall = { op: string; args: Record<string, unknown> };

// Allowlist of ops a suggestion may propose, with typed arg shapes.
// Approval/permission-shaped ops (confirmPlanning, merge approvals, anything that
// answers yes/no FOR the user) are deliberately NOT suggestible: those stay explicit
// native owner UI. A model must never propose an accept flag.
const SHAPES: Record<string, Record<string, 'string' | 'boolean'>> = {
  createProject: { name: 'string', prd: 'string' },
  assignTasks: { projectId: 'string' },
  runBuild: { projectId: 'string', taskId: 'string' },
  submitTaskForReview: { projectId: 'string', taskId: 'string' },
};

// Plain-language consequence shown on the suggestion card before the user clicks Run.
export function describeProposal(p: ProposedCall): string {
  switch (p.op) {
    case 'createProject': return `Create project "${p.args.name}" from a new PRD.`;
    case 'assignTasks': return 'Ask the AI to propose a task split for this project. Nothing is assigned until the owner approves the split.';
    case 'runBuild': return `Run a simulated build for task ${p.args.taskId} in this project.`;
    case 'submitTaskForReview': return `Submit task ${p.args.taskId} for the owner's merge review.`;
    default: return p.op;
  }
}

export function validateProposal(raw: unknown): { ok: true; proposal: ProposedCall } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Not an object.' };
  const o = raw as Record<string, unknown>;
  if (typeof o.op !== 'string' || !(o.op in SHAPES)) return { ok: false, error: `Op not allowed: ${String(o.op).slice(0, 40)}` };
  if (!o.args || typeof o.args !== 'object' || Array.isArray(o.args)) return { ok: false, error: 'Missing args.' };
  const shape = SHAPES[o.op];
  const args = o.args as Record<string, unknown>;
  for (const k of Object.keys(args)) if (!(k in shape)) return { ok: false, error: `Unexpected arg: ${k}` };
  for (const [k, t] of Object.entries(shape)) {
    if (typeof args[k] !== t) return { ok: false, error: `Arg ${k} must be a ${t}.` };
    if (t === 'string' && ((args[k] as string).length === 0 || (args[k] as string).length > 200)) return { ok: false, error: `Arg ${k} length out of range.` };
  }
  return { ok: true, proposal: { op: o.op, args } };
}

// Context validation: a shape-valid proposal can still be unusable (stale context,
// wrong project, a task that does not exist, or a task the asker may not run).
// Such proposals are REJECTED with an explanation - never shown as a usable action.
// Run-time gates still revalidate everything when the user clicks Run.
export type SuggestionContext = {
  projectId: string;
  isOwner: boolean;
  tasks: { id: string; assigneeId: string | null }[];
};

export function validateProposalContext(p: ProposedCall, ctx: SuggestionContext, userId: string): { ok: true } | { ok: false; error: string } {
  if (typeof p.args.projectId === 'string' && p.args.projectId !== ctx.projectId)
    return { ok: false, error: 'Stale context: the suggestion targets a different project.' };
  if (p.op === 'assignTasks' && !ctx.isOwner) return { ok: false, error: "Only the owner's AI can assign tasks." };
  if (p.op === 'runBuild' || p.op === 'submitTaskForReview') {
    const tid = String(p.args.taskId);
    const t = ctx.tasks.find((x) => x.id === tid);
    if (!t) return { ok: false, error: `Task ${tid} does not exist in this project.` };
    if (t.assigneeId !== userId && !ctx.isOwner) return { ok: false, error: `Task ${tid} is not yours.` };
  }
  return { ok: true };
}

// Project targeting: the model often invents a projectId, so a mismatch alone is noise
// and the server may normalize it to the current project. But when the USER explicitly
// named a different project (by id or name) in the command, normalizing would silently
// retarget their request - that must be rejected with an explanation instead.
export function resolveProjectTarget(
  proposedPid: string | undefined,
  currentPid: string,
  commandText: string,
  otherProjects: { id: string; name: string }[],
): { ok: true; projectId: string } | { ok: false; error: string } {
  const text = commandText.toLowerCase();
  // An explicit other-project name in the command always rejects, even if the model
  // happened to target the current project - the user's words win over the model's call.
  const namedOther = otherProjects.find((o) => o.id !== currentPid && o.name && text.includes(o.name.toLowerCase()));
  if (!proposedPid || proposedPid === currentPid)
    return namedOther ? { ok: false, error: `That command is about project "${namedOther.name}" - open it to run this there. Nothing was done in this project.` } : { ok: true, projectId: currentPid };
  // Only a REAL other-project id typed in the command counts as explicit; model garbage
  // that happens to be a substring of the command (e.g. a task id) is still normalized.
  const explicitId = otherProjects.some((o) => o.id === proposedPid) && text.includes(proposedPid.toLowerCase());
  if (namedOther) return { ok: false, error: `That command is about project "${namedOther.name}" - open it to run this there. Nothing was done in this project.` };
  if (explicitId) return { ok: false, error: 'That command names a different project id - open that project to run this there. Nothing was done in this project.' };
  return { ok: true, projectId: currentPid }; // model noise: bind to the current project
}
