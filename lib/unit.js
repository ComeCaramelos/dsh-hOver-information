/**
 * @comecaramelos/dsh-hover-information — `hoverInfo` projection unit.
 *
 * A pure, synchronous, plugin-registerable projection (same contract as the
 * stock `sessionStats` / `contextPressure` units, `dsh-session-projection`).
 * It folds one session's durable event log into the per-session metrics the
 * browser hover-card enhancer renders (docs/PLAN.md §4/§5.1): turns, steps,
 * token totals, compactions, subagent spawns, tool-call count, active time,
 * and the last request's model / context-window sample.
 *
 * The registration contract runs through ZOD (`def.stateSchema.parse` /
 * `def.wire.viewSchema.parse` — `dsh-session-projection` drive, verified
 * against the installed harness rc.2), which follows the `dsh-session-stats`
 * reference unit (`import { z } from "zod"`). A schemastery-built schema is
 * NOT valid here: schemastery has no `.parse` method, so every session
 * projection (and every `dsk`-driven `commands/list` warm-up) would throw
 * `def.wire.viewSchema.parse is not a function`.
 *
 * Sources verified against the installed harness (0.1.5-rc.2):
 * - `step/start` / `step/end` / `turn/end`: `{ turn, step }`,
 *   `{ turn, step }`, `{ turn, reason }` (`dsh-agent-loop`).
 * - `assistant/message`: `{ turn, step, message, usage?, stream }`;
 *   `usage` is the `TokenUsage` face (input/output/cache fields) and the
 *   routed model rides on `message.source.model`.
 * - `request/context`: `{ provider, model, contextWindow }` — appended when
 *   the request image changes (`dsh-agent-loop`), durable through
 *   compaction; it is the honest context-window source.
 * - `tool/call`: `{ turn, step, callId, name, arguments }`;
 *   `tool/result`: `{ turn, step, message: { callId, … } }`.
 * - `compaction/end`: `{ compactionId, turn }` (`dsh-compaction-basic`).
 * - `subagent/catalog`: one whole-child discovery fact per established
 *   subagent (`dsh-subagent`). Note: `subagent/start` is an *event-bus*
 *   emit, not a log event — the durable per-child fact is `subagent/catalog`.
 *
 * Every transition returns the previous reference for unrelated events so
 * the registry's change feed stays silent (whole-value rule).
 */
import { z } from "zod";

/** Nullable scalars use zod's `.nullable()` (zod v4 has no `z.const`). */
const nullableNumber = z.number().nullable();
const nullableString = z.string().nullable();

/** Last prompt-token sample taken from an assistant message. */
export const hoverInfoLastContextSchema = z.object({
	tokens: z.number(),
	at: z.number()
});

/** Last routed request-image sample (`request/context`). */
export const hoverInfoLastRequestSchema = z.object({
	provider: z.string(),
	model: z.string(),
	contextWindow: nullableNumber,
	at: z.number()
});

/** Open `step/start` used to attribute LLM wall-time. */
export const hoverInfoOpenStepSchema = z.object({
	turn: z.number(),
	step: z.number(),
	startTime: z.number()
});

/** In-flight `tool/call` pairings keyed by provider call id. */
export const hoverInfoPendingCallsSchema = z.record(z.string(), z.number());

/** Full folded state; every field carries a default so stored snapshots resolve. */
export const hoverInfoStateSchema = z.object({
	turns: z.number().default(0),
	steps: z.number().default(0),
	lastTurn: nullableNumber.default(null),
	tokensIn: z.number().default(0),
	tokensOut: z.number().default(0),
	cacheRead: z.number().default(0),
	cacheWrite: z.number().default(0),
	compactions: z.number().default(0),
	subagentsSpawned: z.number().default(0),
	toolCalls: z.number().default(0),
	llmMs: z.number().default(0),
	toolMs: z.number().default(0),
	lastContext: hoverInfoLastContextSchema.nullable().default(null),
	lastRequest: hoverInfoLastRequestSchema.nullable().default(null),
	openStep: hoverInfoOpenStepSchema.nullable().default(null),
	pendingCalls: hoverInfoPendingCallsSchema.default({}),
	createdAt: nullableNumber.default(null)
});

/** Client-visible view: the wire shape served by `snapshot()` (fully resolved numbers). */
export const hoverInfoViewSchema = z.object({
	turns: z.number(),
	steps: z.number(),
	tokensIn: z.number(),
	tokensOut: z.number(),
	cacheRead: z.number(),
	cacheWrite: z.number(),
	compactions: z.number(),
	subagentsSpawned: z.number(),
	toolCalls: z.number(),
	llmMs: z.number(),
	toolMs: z.number(),
	lastContext: hoverInfoLastContextSchema.nullable(),
	lastRequest: hoverInfoLastRequestSchema.nullable(),
	createdAt: nullableNumber
});

function num(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Fold one state forward one committed session event. */
function hoverInfoApply(state, event) {
	switch (event.type) {
		case "step/start": {
			const turn = num(event.data?.turn);
			const step = num(event.data?.step);
			return { ...state, openStep: { turn, step, startTime: event.time } };
		}
		case "assistant/message": {
			let next = state;
			const openStep = state.openStep;
			if (openStep !== null && openStep.turn === num(event.data?.turn) && openStep.step === num(event.data?.step)) {
				next = { ...next, llmMs: next.llmMs + Math.max(0, event.time - openStep.startTime) };
			}
			if (next.openStep !== null) next = { ...next, openStep: null };
			const usage = event.data?.usage;
			if (usage && typeof usage === "object") {
				const tokens = num(usage.inputTokens);
				next = {
					...next,
					tokensIn: next.tokensIn + tokens,
					tokensOut: next.tokensOut + num(usage.outputTokens),
					cacheRead: next.cacheRead + num(usage.cacheReadTokens),
					cacheWrite: next.cacheWrite + num(usage.cacheWriteTokens),
					lastContext: { tokens, at: event.time }
				};
			}
			return next;
		}
		case "tool/call": {
			const callId = event.data?.callId;
			const next = { ...state, toolCalls: state.toolCalls + 1 };
			if (typeof callId === "string" && callId !== "") {
				const pendingCalls = Object.assign({}, state.pendingCalls);
				pendingCalls[callId] = event.time;
				next.pendingCalls = pendingCalls;
			}
			return next;
		}
		case "tool/result": {
			const callId = event.data?.message?.callId ?? event.data?.callId;
			if (typeof callId !== "string" || !Object.prototype.hasOwnProperty.call(state.pendingCalls, callId)) return state;
			const started = state.pendingCalls[callId];
			const pendingCalls = Object.assign({}, state.pendingCalls);
			delete pendingCalls[callId];
			return { ...state, toolMs: state.toolMs + Math.max(0, event.time - started), pendingCalls };
		}
		case "step/end": {
			const turn = num(event.data?.turn);
			let next = state;
			if (state.lastTurn !== turn) next = { ...next, turns: next.turns + 1, lastTurn: turn };
			next = { ...next, steps: next.steps + 1 };
			if (next.openStep !== null) next = { ...next, openStep: null };
			return next;
		}
		case "turn/end": {
			if (Object.keys(state.pendingCalls).length === 0) return state;
			return { ...state, pendingCalls: {} };
		}
		case "compaction/end": {
			return { ...state, compactions: state.compactions + 1 };
		}
		case "subagent/catalog": {
			return { ...state, subagentsSpawned: state.subagentsSpawned + 1 };
		}
		case "request/context": {
			const model = event.data?.model;
			if (typeof model !== "string" || model === "") return state;
			const contextWindow = typeof event.data?.contextWindow === "number" && event.data.contextWindow > 0 ? event.data.contextWindow : null;
			return {
				...state,
				lastRequest: {
					provider: typeof event.data?.provider === "string" ? event.data.provider : "",
					model,
					contextWindow,
					at: event.time
				}
			};
		}
		default:
			return state;
	}
}

/** Wire view over the folded state: drop bookkeeping, keep the wire keys. */
function hoverInfoView(state) {
	return {
		turns: state.turns,
		steps: state.steps,
		tokensIn: state.tokensIn,
		tokensOut: state.tokensOut,
		cacheRead: state.cacheRead,
		cacheWrite: state.cacheWrite,
		compactions: state.compactions,
		subagentsSpawned: state.subagentsSpawned,
		toolCalls: state.toolCalls,
		llmMs: state.llmMs,
		toolMs: state.toolMs,
		lastContext: state.lastContext,
		lastRequest: state.lastRequest,
		createdAt: state.createdAt
	};
}

/**
 * Build the projection definition. Exported as a factory (rather than a
 * frozen constant) so `apply()` registers exactly one instance per mount.
 * @returns a `ProjectionDefinition` consumable by `ctx.sessionProjections.register()`.
 */
export function hoverInfoProjectionDefinition() {
	return {
		key: "hoverInfo",
		stateVersion: 1,
		stateSchema: hoverInfoStateSchema,
		init: (header) => ({
			turns: 0,
			steps: 0,
			lastTurn: null,
			tokensIn: 0,
			tokensOut: 0,
			cacheRead: 0,
			cacheWrite: 0,
			compactions: 0,
			subagentsSpawned: 0,
			toolCalls: 0,
			llmMs: 0,
			toolMs: 0,
			lastContext: null,
			lastRequest: null,
			openStep: null,
			pendingCalls: {},
			createdAt: typeof header?.createdAt === "number" ? header.createdAt : null
		}),
		apply: hoverInfoApply,
		wire: {
			viewSchema: hoverInfoViewSchema,
			view: hoverInfoView
		}
	};
}
