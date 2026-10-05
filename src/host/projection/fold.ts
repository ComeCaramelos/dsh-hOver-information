/**
 * Host half — the `hoverInfo` fold: one durable log event forward in time.
 *
 * Sources verified against the installed harness (0.1.5-rc.2) — docs/PLAN.md
 * §5.1:
 * - `step/start` / `step/end` / `turn/end`: `{ turn, step }`,
 *   `{ turn, step }`, `{ turn, reason }` (`dsh-agent-loop`).
 * - `assistant/message`: `{ turn, step, message, usage?, stream }`; `usage` is
 *   the `TokenUsage` face (input/output/cache fields) and the routed model
 *   rides on `message.source.model`.
 * - `request/context`: `{ provider, model, contextWindow }` — appended when
 *   the request image changes (`dsh-agent-loop`), durable through compaction;
 *   it is the honest context-window source.
 * - `tool/call`: `{ turn, step, callId, name, arguments }`;
 *   `tool/result`: `{ turn, step, message: { callId, … } }`.
 * - `compaction/end`: `{ compactionId, turn }` (`dsh-compaction-basic`).
 * - `compaction/prune`: `{ shadowedRange, shadowedSeqs, shadowedTokenCount }`
 *   (`dsh-compaction-tool-result-pruner`) — one durable event per over-budget
 *   tool result pruned (the "purge" a microcompaction leaves behind), priced
 *   through the shadowed node.
 * - `subagent/catalog`: one whole-child discovery fact per established
 *   subagent (`dsh-subagent`). Note: `subagent/start` is an *event-bus* emit,
 *   not a log event — the durable per-child fact is `subagent/catalog`.
 *
 * Every transition returns the previous reference for unrelated events so the
 * registry's change feed stays silent (whole-value rule).
 */
import type { HoverInfoState, HoverInfoView } from "./state.js";
import type { SessionEvent } from "../types/projection.js";

function num(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Fold one state forward one committed session event. */
export function hoverInfoApply(state: HoverInfoState, event: SessionEvent): HoverInfoState {
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
        case "compaction/prune": {
            return { ...state, purges: state.purges + 1 };
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
export function hoverInfoView(state: HoverInfoState): HoverInfoView {
    return {
        turns: state.turns,
        steps: state.steps,
        tokensIn: state.tokensIn,
        tokensOut: state.tokensOut,
        cacheRead: state.cacheRead,
        cacheWrite: state.cacheWrite,
        compactions: state.compactions,
        purges: state.purges,
        subagentsSpawned: state.subagentsSpawned,
        toolCalls: state.toolCalls,
        llmMs: state.llmMs,
        toolMs: state.toolMs,
        lastContext: state.lastContext,
        lastRequest: state.lastRequest,
        createdAt: state.createdAt
    };
}
