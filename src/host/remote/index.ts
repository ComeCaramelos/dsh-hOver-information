/**
 * Host half — the `hoverInfo` Typert remote.
 *
 * Exposes three RPC methods to the browser over the generic HTTP
 * endpoint surface (`POST /api/hoverInfo/<method>`):
 *
 *   ./sessions.ts   `sessions()` — the live sidebar list for card matching
 *   ./stats.ts      `stats(sessionId)` — the live metric view
 *   ./jobs.ts       `killJob(sessionId, jobId)` — cancel one live job
 *
 * Remote registration uses the documented manual descriptor rather than
 * decorators: plain-JS class decorators are not available without a build step,
 * and the gateway reads the prototype own-property
 * `"@deepseek-ai/dsh-typert-protocol/remote-methods"` (`remoteMethods()`).
 */
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { sessionRows } from "./sessions.js";
import { statsFor } from "./stats.js";
import { killJobFor } from "./jobs.js";
import type { HoverInfoKillResult } from "./jobs.js";
import type { HoverInfoSessionRow, HoverInfoStats } from "../types/stats.js";
import type { PluginContext } from "../types/services.js";

/**
 * Domain failure vocabulary this Remote throws, merged into the protocol's
 * code-discriminated union exactly like every other owner does (the Gateway
 * keeps its infrastructure codes, this block adds `hoverInfo/*`). Declaring
 * them here — not just at the throw sites — is what lets the typed
 * `RemoteError` constructor accept the code, and what lets a typed consumer
 * narrow `details` by `code`. Both codes are fail-open carriers: the browser
 * treats either as "no data" and leaves the stock card untouched.
 */
declare module "@deepseek-ai/dsh-typert-protocol" {
  interface RemoteErrorDetailsMap {
    /** The requested session is not loaded live on this host. */
    "hoverInfo/session-not-found": {};
    /** The session is live but its `hoverInfo` projection did not resolve. */
    "hoverInfo/not-loaded": {};
    /** The host composes no background-job registry. */
    "hoverInfo/jobs-unavailable": {};
    /** The kill was rejected: job id unknown, or owned by another session. */
    "hoverInfo/job-not-found": {};
  }
}

/** Prototype descriptor key the protocol reads. */
const REMOTE_METHOD_DESCRIPTOR = "@deepseek-ai/dsh-typert-protocol/remote-methods";

export class HoverInfoRemote extends TypertRemoteService {
    static inject = ["sessions", "sessionProjections"];

    constructor(ctx: PluginContext) {
        super(ctx, "hoverInfoRemote", { namespace: "hoverInfo" });
    }

    /**
     * Live session rows for the client's card matching.
     * @returns `{ id, title, updatedAt, running, cwd, createdAt }` per live session.
     */
    sessions(): HoverInfoSessionRow[] {
        return sessionRows(this.ctx);
    }

    /**
     * Full metric view for one live session.
     * @param sessionId - session id to read.
     * @returns the `hoverInfo` wire view plus live running-subagent counts.
     */
    stats(sessionId: string): HoverInfoStats {
        return statsFor(this.ctx, sessionId);
    }

    /**
     * Request the cancellation of one live session's background job.
     *
     * The kill rides the base-profile `ctx.jobs` registry with the owning
     * session's live agent as the caller (the same owner check `job_kill`
     * performs), so a request addressed to a session that does not own the
     * job is refused rather than silently honoured.
     *
     * @param sessionId - the owning session id.
     * @param jobId - the background-job id.
     * @returns `{ outcome }` — `"requested"`, or `"already-finished"` when
     *   the registry says the job had already settled.
     * @throws RemoteError `hoverInfo/jobs-unavailable`,
     *   `hoverInfo/session-not-found` or `hoverInfo/job-not-found`.
     */
    killJob(sessionId: string, jobId: string): HoverInfoKillResult {
        return killJobFor(this.ctx, sessionId, jobId);
    }
}

/**
 * Attach the manual `@Remote` markers the protocol reads off the prototype
 * (docs/PLAN.md §5.2 fallback; no decorator risk). Idempotent.
 */
Object.defineProperty(HoverInfoRemote.prototype, REMOTE_METHOD_DESCRIPTOR, {
    configurable: true,
    value: Object.freeze({
        version: 1,
        methods: Object.freeze([
            Object.freeze({ method: "sessions", invocation: Object.freeze({ kind: "direct" }) }),
            Object.freeze({ method: "stats", invocation: Object.freeze({ kind: "direct" }) }),
            Object.freeze({ method: "killJob", invocation: Object.freeze({ kind: "direct" }) })
        ])
    })
});
