/**
 * Host half — the `hoverInfo` projection: durable-log views.
 *
 * These describe what the registry hands the fold; they stay structural because
 * the durable log vocabulary belongs to the host packages (docs/PLAN.md §5.1)
 * and a drift there must degrade a metric, never fail the fold.
 */

/**
 * One committed session event, as the projection registry hands it to
 * `apply`. Only `type`, `time` and the few `data` fields this fold reads are
 * typed; everything else stays structural.
 */
export interface SessionEvent {
    /** Durable event type (`step/start`, `assistant/message`, …). */
    readonly type: string;
    /** Event timestamp. */
    readonly time: number;
    /** Event payload; field shape varies per `type` and is probed, never asserted. */
    readonly data?: any;
    /** Remaining log-record fields, kept structurally for pass-through. */
    readonly [key: string]: any;
}

/** Session header fields the fold reads at registration time. */
export interface ProjectionHeader {
    /** Session creation time, when the host carries one. */
    readonly createdAt?: number | null;
}
