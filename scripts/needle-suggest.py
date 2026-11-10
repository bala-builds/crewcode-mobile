# CrewCode command-suggestion sidecar (local Needle via cactus-compute, Apache-2.0).
# Reads one command on stdin, prints ONE proposed tool call as JSON on stdout:
#   {"op": "...", "args": {...}} or {"none": "reason"}
# Approval/permission ops are deliberately absent from the tool surface.
import json, sys

def main():
    command = sys.stdin.read().strip()
    if not command:
        print(json.dumps({"none": "empty command"})); return
    try:
        import cactus
    except Exception as e:
        print(json.dumps({"none": f"needle unavailable: {e}"})); return

    @cactus.tool
    def createProject(name: str, prd: str):
        "Create a new CrewCode project. name: the app name the user gave. prd: short description of the app."
        return {"created": name}

    @cactus.tool
    def assignTasks(projectId: str):
        "Split the project PRD into feature tasks for the team. projectId: the current project id."
        return {"assigned": projectId}

    @cactus.tool
    def runBuild(projectId: str, taskId: str):
        "Run a simulated build for one task. taskId: the task id like t1."
        return {"built": taskId}

    @cactus.tool
    def submitTaskForReview(projectId: str, taskId: str):
        "Submit a done task for the owner's merge review."
        return {"submitted": taskId}

    project_id = sys.argv[1] if len(sys.argv) > 1 else "p1"
    tasks = json.loads(sys.argv[2]) if len(sys.argv) > 2 else []
    tlist = ", ".join(f"{t['id']} ({t.get('title','')})" for t in tasks) or "none yet"
    sysmsg = (f"You route user commands to CrewCode tool calls. Use projectId '{project_id}' "
              f"when the user does not name a project. Existing tasks in this project: {tlist}. "
              "For runBuild and submitTaskForReview use ONLY these task ids; if the user names no "
              "existing task, pick the first one that fits.")
    try:
        with cactus.Cactus(tools=[createProject, assignTasks, runBuild, submitTaskForReview], system=sysmsg) as agent:
            out = agent.complete(command)  # propose only; never execute here
    except Exception as e:
        print(json.dumps({"none": f"inference failed: {e}"})); return
    calls = (out or {}).get("function_calls") or []
    if not calls:
        print(json.dumps({"none": "no confident suggestion", "reasoning": (out or {}).get("reasoning", "")[:200]})); return
    c = calls[0]
    print(json.dumps({"op": c.get("name"), "args": c.get("arguments") or {}}))

main()
