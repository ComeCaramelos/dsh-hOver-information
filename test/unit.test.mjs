/**
 * Projection fold tests: a synthetic session log drives the pure `hoverInfo`
 * unit; expected values are a lockstep table over docs/PLAN.md §5.1 plus the
 * rc.2-verified payload shapes (tool ids inside `message`, `subagent/catalog`
 * as the durable spawn fact, `request/context` for window/model).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { hoverInfoProjectionDefinition } from "../lib/unit.js";

function fold(events, header = { createdAt: 1000 }) {
	const def = hoverInfoProjectionDefinition();
	let state = def.init(header);
	for (const event of events) state = def.apply(state, event);
	return { state, view: def.wire.view(state), def };
}

test("clean multi-turn log folds every metric", () => {
	const events = [
		{ type: "request/context", seq: 1, time: 1010, data: { provider: "acme", model: "model-x", contextWindow: 128000 } },
		{ type: "turn/start", seq: 2, time: 1020, data: { turn: 1 } },
		{ type: "step/start", seq: 3, time: 1021, data: { turn: 1, step: 1 } },
		{
			type: "assistant/message",
			seq: 4,
			time: 1051,
			data: {
				turn: 1,
				step: 1,
				message: { source: { provider: "acme", model: "model-x" }, content: [] },
				usage: { inputTokens: 81200, outputTokens: 300, cacheReadTokens: 20000, cacheWriteTokens: 5 }
			}
		},
		{ type: "tool/call", seq: 5, time: 1060, data: { turn: 1, step: 1, callId: "c1", name: "read", arguments: {} } },
		{ type: "tool/result", seq: 6, time: 1080, data: { turn: 1, step: 1, message: { callId: "c1", content: [] } } },
		{ type: "step/end", seq: 7, time: 1090, data: { turn: 1, step: 1 } },
		{ type: "step/start", seq: 8, time: 1091, data: { turn: 1, step: 2 } },
		{
			type: "assistant/message",
			seq: 9,
			time: 1121,
			data: {
				turn: 1,
				step: 2,
				message: { source: { provider: "acme", model: "model-x" }, content: [] },
				usage: { inputTokens: 82000, outputTokens: 100 }
			}
		},
		{ type: "step/end", seq: 10, time: 1131, data: { turn: 1, step: 2 } },
		{ type: "turn/end", seq: 11, time: 1132, data: { turn: 1, reason: { kind: "completed" } } },
		{ type: "turn/start", seq: 12, time: 1200, data: { turn: 2 } },
		{ type: "step/start", seq: 13, time: 1201, data: { turn: 2, step: 1 } },
		{ type: "compaction/end", seq: 14, time: 1210, data: { compactionId: "comp-1", turn: 2 } },
		{ type: "subagent/catalog", seq: 15, time: 1215, data: { version: 0, childId: "child-a", mode: "one-shot" } },
		{ type: "subagent/catalog", seq: 16, time: 1216, data: { version: 0, childId: "child-b", mode: "continuable" } },
		{
			type: "assistant/message",
			seq: 17,
			time: 1251,
			data: {
				turn: 2,
				step: 1,
				message: { source: { provider: "acme", model: "model-x" }, content: [] },
				usage: { inputTokens: 500, outputTokens: 50 }
			}
		},
		{ type: "step/end", seq: 18, time: 1261, data: { turn: 2, step: 1 } },
		{ type: "turn/end", seq: 19, time: 1262, data: { turn: 2, reason: { kind: "completed" } } },
		{ type: "session/title", seq: 20, time: 1300, data: { title: "Fix bug" } },
		{ type: "unknown/event", seq: 21, time: 1400, data: {} }
	];
	const { view } = fold(events);
	assert.equal(view.turns, 2, "turn counted once per distinct turn/end group");
	assert.equal(view.steps, 3);
	assert.equal(view.tokensIn, 81200 + 82000 + 500);
	assert.equal(view.tokensOut, 300 + 100 + 50);
	assert.equal(view.cacheRead, 20000, "absent cache fields add zero");
	assert.equal(view.cacheWrite, 5);
	assert.equal(view.compactions, 1);
	assert.equal(view.subagentsSpawned, 2);
	assert.equal(view.toolCalls, 1);
	assert.equal(view.llmMs, (1051 - 1021) + (1121 - 1091) + (1251 - 1201));
	assert.equal(view.toolMs, 1080 - 1060);
	assert.deepEqual(view.lastContext, { tokens: 500, at: 1251 });
	assert.deepEqual(view.lastRequest, { provider: "acme", model: "model-x", contextWindow: 128000, at: 1010 });
	assert.equal(view.createdAt, 1000);
});

test("repeated step/end inside one turn counts steps but one turn", () => {
	const events = [
		{ type: "step/end", time: 11, data: { turn: 1, step: 1 } },
		{ type: "step/end", time: 12, data: { turn: 1, step: 2 } },
		{ type: "step/end", time: 13, data: { turn: 1, step: 3 } },
		{ type: "step/end", time: 14, data: { turn: 1, step: 4 } }
	];
	const { view } = fold(events);
	assert.equal(view.turns, 1);
	assert.equal(view.steps, 4);
});

test("repeated step/end on the same turn does not recount turns", () => {
	const events = [
		{ type: "step/end", time: 11, data: { turn: 1, step: 1 } },
		{ type: "step/end", time: 21, data: { turn: 1, step: 1 } }
	];
	assert.equal(fold(events).view.turns, 1, "lastTurn deduplicates turn counting");
});

test("usage without numbers does not pollute totals", () => {
	const events = [
		{ type: "assistant/message", time: 11, data: { turn: 1, step: 1, message: {} } },
		{
			type: "assistant/message",
			time: 21,
			data: { turn: 1, step: 1, message: {}, usage: { inputTokens: "100", outputTokens: null } }
		},
		{
			type: "assistant/message",
			time: 31,
			data: { turn: 1, step: 1, message: {}, usage: { inputTokens: 10, outputTokens: 2 } }
		}
	];
	const { view } = fold(events);
	assert.equal(view.tokensIn, 10);
	assert.equal(view.tokensOut, 2);
	assert.deepEqual(view.lastContext, { tokens: 10, at: 31 });
});

test("tool pairing survives interleaving and drops on turn end", () => {
	const events = [
		{ type: "tool/call", time: 11, data: { turn: 1, step: 1, callId: "a" } },
		{ type: "tool/call", time: 12, data: { turn: 1, step: 1, callId: "b" } },
		{ type: "tool/result", time: 30, data: { turn: 1, step: 1, message: { callId: "b" } } },
		{ type: "turn/end", time: 31, data: { turn: 1, reason: { kind: "aborted" } } },
		{ type: "tool/result", time: 40, data: { turn: 1, step: 1, message: { callId: "a" } } }
	];
	const { view } = fold(events);
	assert.equal(view.toolCalls, 2);
	assert.equal(view.toolMs, 18, "pair a cleared at turn/end is discarded, pair b counted");
});

test("request/context with unknown window keeps model but null window", () => {
	const events = [{ type: "request/context", time: 5, data: { provider: "p", model: "m" } }];
	const { view } = fold(events);
	assert.deepEqual(view.lastRequest, { provider: "p", model: "m", contextWindow: null, at: 5 });
});

test("unrelated events keep the state reference (silent change feed)", () => {
	const def = hoverInfoProjectionDefinition();
	const state = def.init({ createdAt: 1 });
	const passed = def.apply(state, { type: "unknown", time: 2, data: {} });
	assert.ok(Object.is(passed, state));
});

test("open step does not leak across turns for llmMs", () => {
	const events = [
		{ type: "step/start", time: 10, data: { turn: 1, step: 1 } },
		{ type: "turn/end", time: 12, data: { turn: 1, reason: { kind: "aborted" } } },
		{
			type: "assistant/message",
			time: 50,
			data: { turn: 2, step: 1, message: {}, usage: { inputTokens: 1, outputTokens: 1 } }
		}
	];
	assert.equal(fold(events).view.llmMs, 0, "message does not belong to the open step pair");
});
