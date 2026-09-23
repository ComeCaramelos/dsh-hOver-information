/**
 * Remote tests: a fake ctx (sessions store, projections face, agents face)
 * drives `sessions()` / `stats()` exactly as the gateway would; no live
 * composition. The manual prototype descriptor is asserted to read as the
 * protocol's `remoteMethods()` output, which is what the gateway claims.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { remoteMethods } from "@deepseek-ai/dsh-typert-protocol";
import { HoverInfoRemote } from "../lib/index.js";

/** Minimal live-session face: id + header + no log (projections faked). */
function session(id, header = {}) {
	return { id, header };
}

function makeRemote({ sessions = [], agents = new Map(), projectionValues = {}, registryThrows = false, jobs = void 0 } = {}) {
	const registry = {
		snapshot(target, keys) {
			if (registryThrows) throw new Error("registry unavailable");
			const values = projectionValues[String(target.id)] ?? {};
			const picked = {};
			for (const key of keys) if (Object.prototype.hasOwnProperty.call(values, key)) picked[key] = values[key];
			return { asOfSeq: 0, values: picked };
		}
	};
	const ctx = {
		reflect: { provide() {} },
		get(name) {
			if (name === "sessions") return { list: () => sessions, get: (id) => sessions.find((item) => item.id === id) };
			if (name === "agents") return { get: (id) => agents.get(id) };
			if (name === "sessionProjections") return registry;
			if (name === "jobs") return jobs;
			return void 0;
		}
	};
	return new HoverInfoRemote(ctx);
}

/**
 * A fake `ctx.jobs` shaped like `LocalJobRegistry`: id → live record, with
 * the caller/owner check and the terminal-status short-circuit of the real
 * kill (the "unknown job" throw included).
 */
function makeJobs(records = []) {
	const byId = new Map();
	for (const record of records) byId.set(record.id, record);
	return {
		kills: [],
		kill(id, caller, reason) {
			this.kills.push({ id, caller: caller ? caller.id : void 0, reason });
			const job = byId.get(id);
			if (job === void 0) throw new Error(`unknown job ${id}`);
			if (job.owner !== void 0 && job.owner.id !== (caller ? caller.id : void 0)) throw new Error(`job ${id} belongs to another session`);
			if (job.status === "completed" || job.status === "killed" || job.status === "failed") return "already-finished";
			return "requested";
		}
	};
}

test("the prototype descriptor registers all three methods as direct remotes", () => {
	const remote = makeRemote({});
	assert.deepEqual(remoteMethods(remote), [
		{ method: "sessions", invocation: { kind: "direct" } },
		{ method: "stats", invocation: { kind: "direct" } },
		{ method: "killJob", invocation: { kind: "direct" } }
	]);
});

test("sessions() maps live sessions through the list formula", () => {
	const now = Date.now();
	const sessions = [
		session("a", { createdAt: now - 100000, cwd: "/home/u/proj" }),
		session("b", { createdAt: now - 1000 })
	];
	const remote = makeRemote({
		sessions,
		agents: new Map([["b", { status: "running" }]]),
		projectionValues: {
			a: { title: "Alpha session", sessionListMetadata: { lastPromptAt: now - 10 } },
			b: {}
		}
	});
	const rows = remote.sessions();
	assert.equal(rows.length, 2);
	const a = rows.find((row) => row.id === "a");
	assert.equal(a.title, "Alpha session");
	assert.equal(a.updatedAt, now - 10, "max(createdAt, lastPromptAt)");
	assert.equal(a.running, false);
	assert.equal(a.cwd, "/home/u/proj");
	const b = rows.find((row) => row.id === "b");
	assert.equal(b.title, null);
	assert.equal(b.updatedAt, now - 1000);
	assert.equal(b.running, true);
});

test("sessions() survives an empty store and a missing sessions service", () => {
	assert.deepEqual(makeRemote({ sessions: [] }).sessions(), []);
	const ctx = { reflect: { provide() {} }, get() { return void 0; } };
	assert.deepEqual(new HoverInfoRemote(ctx).sessions(), []);
});

test("stats() folds the projection view and counts live running children", () => {
	const view = {
		turns: 3,
		steps: 7,
		tokensIn: 120000,
		tokensOut: 5400,
		cacheRead: 80000,
		cacheWrite: 0,
		compactions: 1,
		subagentsSpawned: 2,
		toolCalls: 12,
		llmMs: 4000,
		toolMs: 2500,
		lastContext: { tokens: 81200, at: 123 },
		lastRequest: { provider: "acme", model: "model-x", contextWindow: 128000, at: 100 },
		createdAt: 55
	};
	const sessions = [
		session("parent", { createdAt: 55 }),
		session("live-kid", { origin: "subagent", parentSession: "parent" }),
		session("dead-kid", { origin: "subagent", parentSession: "parent" }),
		session("other-kid", { origin: "subagent", parentSession: "other" })
	];
	const remote = makeRemote({
		sessions,
		agents: new Map([["live-kid", { status: "running" }]]),
		projectionValues: { parent: { hoverInfo: view } }
	});
	const result = remote.stats("parent");
	assert.equal(result.turns, 3);
	assert.equal(result.toolCalls, 12);
	assert.deepEqual(result.lastRequest, view.lastRequest);
	assert.equal(result.subagentsRunning, 1, "only live running direct subagent children count");
});

test("stats() fails open with typed errors", () => {
	const remote = makeRemote({ sessions: [] });
	assert.throws(() => remote.stats("nope"), (error) => error.code === "hoverInfo/session-not-found");

	const viewless = makeRemote({
		sessions: [session("x", {})],
		projectionValues: { x: {} }
	});
	assert.throws(() => viewless.stats("x"), (error) => error.code === "hoverInfo/not-loaded");

	const broken = makeRemote({ sessions: [session("x", {})], registryThrows: true });
	assert.throws(() => broken.stats("x"), (error) => error.code === "hoverInfo/not-loaded");
});

test("killJob() hands the registry the owning agent as caller and maps the outcome", () => {
	const jobs = makeJobs([
		{ id: "j1", owner: { id: "s1" }, status: "running" },
		{ id: "j2", owner: { id: "s1" }, status: "completed" }
	]);
	const remote = makeRemote({
		sessions: [session("s1", {})],
		agents: new Map([["s1", { id: "s1", status: "idle" }]]),
		jobs
	});
	assert.deepEqual(remote.killJob("s1", "j1"), { outcome: "requested" });
	assert.deepEqual(jobs.kills, [{ id: "j1", caller: "s1", reason: void 0 }], "kill(id, agent) — the caller is the owning agent");
	assert.deepEqual(remote.killJob("s1", "j2"), { outcome: "already-finished" });
});

test("killJob() fails open with typed errors", () => {
	// No registry composed at all.
	const noJobs = makeRemote({ sessions: [session("s1", {})], agents: new Map([["s1", { id: "s1" }]]) });
	assert.throws(() => noJobs.killJob("s1", "x"), (error) => error.code === "hoverInfo/jobs-unavailable");

	// Registry composed, session not live (an owned job needs its agent).
	const dead = makeRemote({ sessions: [], jobs: makeJobs([{ id: "j1", owner: { id: "s1" }, status: "running" }]) });
	assert.throws(() => dead.killJob("s1", "j1"), (error) => error.code === "hoverInfo/session-not-found");

	// Live session, unknown job id.
	const live = makeRemote({
		sessions: [session("s1", {})],
		agents: new Map([["s1", { id: "s1" }]]),
		jobs: makeJobs([{ id: "j1", owner: { id: "s1" }, status: "running" }])
	});
	assert.throws(() => live.killJob("s1", "nope"), (error) => error.code === "hoverInfo/job-not-found");
});
