/**
 * Host half — the `hoverInfo` projection: state and wire-view schemas.
 *
 * The registration contract runs through ZOD (`def.stateSchema.parse` /
 * `def.wire.viewSchema.parse` — `dsh-session-projection` drive, verified
 * against the installed harness rc.2), which follows the `dsh-session-stats`
 * reference unit (`import { z } from "zod"`). A schemastery-built schema is
 * NOT valid here: schemastery has no `.parse` method, so every session
 * projection (and every `dsk`-driven `commands/list` warm-up) would throw
 * `def.wire.viewSchema.parse is not a function`.
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
    purges: z.number().default(0),
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
    purges: z.number(),
    subagentsSpawned: z.number(),
    toolCalls: z.number(),
    llmMs: z.number(),
    toolMs: z.number(),
    lastContext: hoverInfoLastContextSchema.nullable(),
    lastRequest: hoverInfoLastRequestSchema.nullable(),
    createdAt: nullableNumber
});

/** Folded state resolved by `hoverInfoStateSchema`. */
export type HoverInfoState = z.infer<typeof hoverInfoStateSchema>;

/** Client-visible view resolved by `hoverInfoViewSchema`. */
export type HoverInfoView = z.infer<typeof hoverInfoViewSchema>;

/**
 * The initial state of one folded session — the `init` half of the projection
 * definition (every fold field zeroes out; the session header's creation time
 * is carried through when present).
 */
export function hoverInfoInitialState(createdAt: number | null): HoverInfoState {
    return {
        turns: 0,
        steps: 0,
        lastTurn: null,
        tokensIn: 0,
        tokensOut: 0,
        cacheRead: 0,
        cacheWrite: 0,
        compactions: 0,
        purges: 0,
        subagentsSpawned: 0,
        toolCalls: 0,
        llmMs: 0,
        toolMs: 0,
        lastContext: null,
        lastRequest: null,
        openStep: null,
        pendingCalls: {},
        createdAt
    };
}
