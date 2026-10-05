/**
 * Browser half — session identity for an open hover card.
 *
 * Fiber fast-path first (`SessionHoverContent`'s `node.id` prop — the same
 * `node` every other plugin reads), DOM title+time fallback second. The DOM
 * fallback matches the stock title against the store's `displayTitle`s; a
 * duplicate title breaks the tie only on the localized relative-time label,
 * anything ambiguous leaves the stock card untouched (AGENTS rule).
 */
import { looksPath, secondLineText, titleLine } from "./lines.js";
import { findFiberSessionId } from "./fiber.js";
import { sessionsSnapshot, translateWorkspace } from "./host.js";
import { relativeBucket } from "./time.js";

/** Resolved identity for one card element. */
export interface HoverCardIdentity {
    id: string;
    cwd?: string;
}

export function identify(env: { ctx: any; win: any }, cardEl: any): HoverCardIdentity | null {
    var snap = sessionsSnapshot(env);
    var byId = snap && snap.byId ? snap.byId : {};
    var nodeId = findFiberSessionId(cardEl);
    if (nodeId !== void 0) {
        var record = byId[nodeId];
        return { id: nodeId, cwd: record && typeof record.cwd === "string" && record.cwd !== "" ? record.cwd : undefined };
    }
    var title = titleLine(cardEl);
    if (title === "" || looksPath(secondLineText(cardEl))) return null;
    var found;
    for (var candidateId in byId) {
        if (!Object.prototype.hasOwnProperty.call(byId, candidateId)) continue;
        var summary = byId[candidateId];
        if (!summary || summary.blank || summary.displayTitle !== title) continue;
        if (found !== void 0) {
            // Same title twice: break the tie on the card's
            // relative-time label; ambiguous → no injection.
            var matches = [];
            for (var otherId in byId) {
                if (!Object.prototype.hasOwnProperty.call(byId, otherId)) continue;
                var other = byId[otherId];
                if (other && !other.blank && other.displayTitle === title) matches.push(otherId);
            }
            var picked = pickByTime(env, cardEl, matches, byId);
            return picked === null ? null : { id: picked, cwd: byId[picked] ? byId[picked].cwd : undefined };
        }
        found = candidateId;
    }
    if (found === void 0) return null;
    return { id: String(found), cwd: typeof byId[found].cwd === "string" && byId[found].cwd !== "" ? byId[found].cwd : undefined };
}

/**
 * Disambiguate same-titled sessions by the relative-time label the card
 * itself shows; a second matching candidate, or a non-numeric
 * `updatedAt`, resolves to nothing.
 */
function pickByTime(env: { ctx: any }, cardEl: any, candidates: string[], byId: Record<string, any>): string | null {
    var now = Date.now();
    var target = secondLineText(cardEl);
    var picked: string | undefined;
    for (var i = 0; i < candidates.length; i++) {
        var updatedAt = byId[candidates[i]].updatedAt;
        if (typeof updatedAt !== "number") return null;
        var bucket = relativeBucket(updatedAt, now);
        var label =
            bucket.unit === "now"
                ? translateWorkspace(env, "time.now")
                : translateWorkspace(env, "time.ago", { t: translateWorkspace(env, "time." + bucket.unit, { n: bucket.n }) });
        if (label !== target) continue;
        if (picked !== void 0) return null;
        picked = candidates[i];
    }
    return picked === void 0 ? null : String(picked);
}
