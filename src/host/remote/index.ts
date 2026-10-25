/**
 * Host half — the `hoverInfo` Typert remote.
 *
 * Exposes two RPC methods to the browser over the generic HTTP
 * endpoint surface (`POST /api/hoverInfo/<method>`):
 *
 *   ./sessions.ts   `sessions()` — the live sidebar list for card matching
 *   ./stats.ts      `stats(sessionId)` — the live metric view
 *
 * Remote registration uses the documented manual descriptor rather than
 * decorators: plain-JS class decorators are not available without a build step,
 * and the gateway reads the prototype own-property
 * `"@deepseek-ai/dsh-typert-protocol/remote-methods"` (`remoteMethods()`).
 */
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { sessionRows } from "./sessions.js";
import { statsFor } from "./stats.js";
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
            Object.freeze({ method: "stats", invocation: Object.freeze({ kind: "direct" }) })
        ])
    })
});
