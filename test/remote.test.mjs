/**
 * Remote tests: a fake ctx (sessions store, projections face, agents face)
 * drives `sessions()` / `stats()` exactly as the gateway would; no live
 * composition. The manual prototype descriptor is asserted to read as the
 * protocol's `remoteMethods()` output, which is what the gateway claims.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { remoteMethods } from "@deepseek-ai/dsh-typert-protocol";
import { HoverInfoRemote } from "../lib/remote.js";

/** Minimal live-session face: id + header + no log (projections faked). */
function session(id, header = {}) {
	return { id, header };
}

function makeRemote({ sessions = [], agents = new Map(), projectionValues = {}, registryThrows = false } = {}) {
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
			return void 0;
		}
	};
	return new HoverInfoRemote(ctx);
}

test("the prototype descriptor registers both methods as direct remotes", () => {
	const remote = makeRemote({});
	assert.deepEqual(remoteMethods(remote), [
		{ method: "sessions", invocation: { kind: "direct" } },
		{ method: "stats", invocation: { kind: "direct" } }
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
