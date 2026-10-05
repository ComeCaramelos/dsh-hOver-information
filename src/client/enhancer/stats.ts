/**
 * Browser half — per-session metrics fetch + cache.
 *
 * Two sources:
 *
 * 1. the live `hoverInfo/stats` fetch — authoritative, but only answerable
 *    while the session is loaded in the host (`session-not-found` otherwise,
 *    which is the common state during and just after a cold start);
 * 2. the browser store's cached projection for that session (`storeHint`) —
 *    served whenever the live view is absent, so a cold card still renders
 *    metrics instead of staying stock until the session happens to be opened.
 *
 * The live fetch is gated per session: a settled hit by `refreshMs`; a
 * miss/failure by `min(refreshMs, FAILURE_RETRY_MS)`, so warming up costs a
 * few extra probes while a card is open instead of a whole TTL of blank card.
 * While a fetch is in flight the current (possibly stale) live view is served,
 * else the hint. A settled hit re-renders every open card of that session.
 */
import { FAILURE_RETRY_MS } from "../constants.js";
import type { EnhancerEnv } from "./env.js";
import { callHostRpc, storeHint } from "./host.js";

/** Live view for one session, or the cached hint, or null. */
export function statsFor(env: EnhancerEnv, sessionId: string): any {
    var now = Date.now();
    var entry = env.statsCache.get(sessionId);
    if (entry === void 0) {
        entry = { at: 0, view: null, pending: false, settled: false };
        env.statsCache.set(sessionId, entry);
    }
    var ttl = entry.settled ? env.refreshMs : Math.min(env.refreshMs, FAILURE_RETRY_MS);
    if (!entry.pending && now - entry.at >= ttl) {
        entry.pending = true;
        callHostRpc(env, "hoverInfo/stats", { sessionId: sessionId }).then(
            function (value: any) {
                var live = env.statsCache.get(sessionId);
                if (live === void 0) return;
                live.pending = false;
                live.at = Date.now();
                live.settled = !!value;
                if (value) {
                    live.view = value;
                    env.refreshAllCards();
                }
            },
            function () {
                var live = env.statsCache.get(sessionId);
                if (live !== void 0) {
                    live.pending = false;
                    live.at = Date.now();
                    live.settled = false;
                }
            }
        );
    }
    if (entry.view !== null && entry.view !== void 0) return entry.view;
    return storeHint(env, sessionId);
}
