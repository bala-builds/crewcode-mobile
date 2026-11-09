import { createRequire } from "node:module";
// \0rolldown/runtime.js
var __require = /* #__PURE__ */ (() => createRequire(import.meta.url))();
// src/core/keysafety.ts
/**
* Key-leak scanner. Phase 5 check: no API response, error, log line or stored state
* may contain anything shaped like a live provider key. Matches are returned masked.
*/
var KEY_PATTERNS = [
	/\bgsk_[A-Za-z0-9_-]{16,}\b/g,
	/\bnv-[A-Za-z0-9_-]{16,}\b/g,
	/\bsk-[A-Za-z0-9_-]{16,}\b/g,
	/\bAIza[A-Za-z0-9_-]{20,}\b/g
];
function maskSecret(s) {
	return s.length <= 6 ? "****" : s.slice(0, 3) + "****" + s.slice(-2);
}
/** Masked matches found in the text. Empty array means clean. */
function scanForKeys(text) {
	const found = [];
	for (const re of KEY_PATTERNS) {
		re.lastIndex = 0;
		for (let m = re.exec(text); m; m = re.exec(text)) found.push(maskSecret(m[0]));
	}
	return found;
}
// src/core/toolhandlers.ts
/**
* Local deterministic tool handlers, bundled into the sandbox runner (toolproc).
* Each receives only the single in-scope file content (and the contract for checks).
* Registered probes exist only when CREWCODE_PROBE=1, for sandbox boundary tests.
*/
/**
* Local deterministic tool handlers. Each receives only the single in-scope file content
* (and the contract for checks) - no project, no network, no writes. That is the whole
* runtime for now; anything needing more is refused by the capability check above.
*/
var LOCAL_TOOL_HANDLERS = {
	"code-review": (content, contract, path) => {
		const lines = content.split("\n").length;
		const shared = [...content.matchAll(/@shared\s+(\w+)/g)].map((m) => m[1]);
		const missing = shared.filter((n) => !contract.includes(n));
		return `Review of ${path}: ${lines} lines. ` + (shared.length ? `Shared names used: ${shared.join(", ")}.` : "No shared names used.") + (missing.length ? ` Not in the contract: ${missing.join(", ")}.` : " All shared names match the contract.");
	},
	"cloudflare-security": (content, _contract, path) => {
		const found = scanForKeys(content);
		return found.length ? `Security scan of ${path}: ${found.length} possible secret(s) found and masked: ${found.join(", ")}. Remove them.` : `Security scan of ${path}: no keys or secrets found.`;
	},
	"docs-mcp": (content, _contract, path) => {
		const headings = content.split("\n").filter((l) => l.trim().startsWith("#")).map((l) => l.trim());
		return `Outline of ${path}: ${content.split("\n").length} lines. ` + (headings.length ? `Headings: ${headings.join(" | ")}` : "No headings found.");
	}
};
if (process.env.CREWCODE_PROBE === "1") {
	LOCAL_TOOL_HANDLERS["__probe_fs"] = () => {
		let fsr = "FS-OPEN";
		let cp = "CP-OPEN";
		let wk = "WK-OPEN";
		try {
			__require("node:fs").readFileSync("/etc/hostname");
		} catch (e) {
			if (e instanceof Error && /restricted|denied/i.test(e.message)) fsr = "FS-DENIED";
			else fsr = "FS-ERR:" + String(e).split("\n")[0];
		}
		try {
			__require("node:child_process").execSync("true");
		} catch (e) {
			if (e instanceof Error && /restricted|denied/i.test(e.message)) cp = "CP-DENIED";
			else cp = "CP-ERR:" + String(e).split("\n")[0];
		}
		try {
			new (__require("node:worker_threads")).Worker("1", { eval: true });
		} catch (e) {
			if (e instanceof Error && /restricted|denied/i.test(e.message)) wk = "WK-DENIED";
			else wk = "WK-ERR:" + String(e).split("\n")[0];
		}
		return `probe: ${fsr} ${cp} ${wk}`;
	};
	LOCAL_TOOL_HANDLERS["__probe_hang"] = () => {
		for (;;);
	};
}
// src/core/skills.ts
var CATALOG = [
	{
		id: "claude-design",
		label: "Claude Design",
		kind: "prebuilt",
		summary: "Design helper (placeholder name from your list). Not runnable in this build.",
		permissions: ["Read the shared contract", "Write inside the member's own folder"],
		verified: false,
		caps: ["read_scope", "write_scope"]
	},
	{
		id: "cloudflare-security",
		label: "Local secret scan",
		kind: "prebuilt",
		summary: "Deterministic local scan of one in-scope file for key-shaped strings, findings masked. (From your list as \"cloudflare security\" - this is not the Cloudflare service.)",
		permissions: ["Read files in the member's own folder"],
		verified: false,
		caps: ["read_scope"]
	},
	{
		id: "code-review",
		label: "Local shared-name check",
		kind: "skill",
		summary: "Deterministic local check of one in-scope file: lists @shared names and compares them to CONTRACT.md. Not a general code review.",
		permissions: ["Read files in the member's own folder"],
		verified: false,
		caps: ["read_scope"]
	},
	{
		id: "docs-mcp",
		label: "Docs outline",
		kind: "mcp",
		summary: "Example MCP-shaped tool: outlines one in-scope document (headings and line count). Runs locally; no network.",
		permissions: ["Read files in the member's own scope"],
		verified: false,
		caps: ["read_scope"]
	}
];
// src/mcp/server-entry.ts
/**
* Genuine MCP server: stdio transport, newline-delimited JSON-RPC 2.0, MCP lifecycle
* (initialize / notifications/initialized), tools/list and tools/call per the
* Model Context Protocol 2025-06-18. Serves the in-repo local tool handlers.
* Runs under Node's permission model when spawned by mcpclient.ts.
*/
var PROTOCOL_VERSION = "2025-06-18";
var result = (id, r) => JSON.stringify({
	jsonrpc: "2.0",
	id,
	result: r
});
var errReply = (id, code, message) => JSON.stringify({
	jsonrpc: "2.0",
	id,
	error: {
		code,
		message
	}
});
function handle(msg) {
	const { id, method, params } = msg;
	switch (method) {
		case "initialize": return result(id, {
			protocolVersion: PROTOCOL_VERSION,
			capabilities: { tools: {} },
			serverInfo: {
				name: "crewcode-local-tools",
				version: "0.1.0"
			}
		});
		case "notifications/initialized": return null;
		case "ping": return result(id, {});
		case "tools/list": return result(id, { tools: Object.keys(LOCAL_TOOL_HANDLERS).map((name) => {
			const cat = CATALOG.find((c) => c.id === name);
			return {
				name,
				title: cat?.label ?? name,
				description: cat?.summary ?? "local tool",
				inputSchema: {
					type: "object",
					properties: {
						content: {
							type: "string",
							description: "Content of the single in-scope file."
						},
						contract: {
							type: "string",
							description: "CONTRACT.md content for checks."
						},
						path: {
							type: "string",
							description: "Path of the file being examined."
						}
					},
					required: ["content", "path"]
				}
			};
		}) });
		case "tools/call": {
			const name = typeof params?.name === "string" ? params.name : "";
			const fn = LOCAL_TOOL_HANDLERS[name];
			if (!fn) return errReply(id, -32602, `Unknown tool: ${name || "(missing)"}`);
			try {
				const a = params?.arguments ?? {};
				return result(id, {
					content: [{
						type: "text",
						text: fn(String(a.content ?? ""), String(a.contract ?? ""), String(a.path ?? ""))
					}],
					isError: false
				});
			} catch (e) {
				return result(id, {
					content: [{
						type: "text",
						text: e instanceof Error ? e.message : String(e)
					}],
					isError: true
				});
			}
		}
		default: return id === void 0 ? null : errReply(id, -32601, "Method not found");
	}
}
var buffer = "";
process.stdin.on("data", (c) => {
	buffer += c.toString("utf8");
	let i;
	while ((i = buffer.indexOf("\n")) >= 0) {
		const line = buffer.slice(0, i).trim();
		buffer = buffer.slice(i + 1);
		if (!line) continue;
		try {
			const reply = handle(JSON.parse(line));
			if (reply) console.log(reply);
		} catch {
			console.log(errReply(null, -32700, "Parse error"));
		}
	}
});
export {};
