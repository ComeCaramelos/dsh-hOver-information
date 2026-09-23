/**
 * Host half — the `hoverInfo` remote: one session's live metric view.
 *
 * `subagent/start|end` are event-BUS emits, not log events (the durable
 * per-child fact is `subagent/catalog`, folded into `subagentsSpawned`), so the
 * live running counts ride the `header.origin === "subagent"` +
 * `header.parentSession === id` lineage of `sessions.list()`
 * (docs/PLAN.md §8.1 spike).
 */
import { RemoteError } from "@deepseek-ai/dsh-typert-protocol";
import { agentsOf, projectionsOf, sessionsOf } from "./services.js";
import type { HoverInfoStats } from "../types/stats.js";
import type { HoverInfoView } from "../projection/state.js";
import type { PluginContext } from "../types/services.js";

/**
 * Full metric view for one live session.
 *
 * @throws RemoteError `hoverInfo/session-not-found` when the session is not
 *   loaded live, `hoverInfo/not-loaded` when its projection did not resolve
 *   (the browser treats either as "no data" and leaves the stock card
 *   untouched — fail-open).
 */
export function statsFor(ctx: PluginContext, sessionId: string): HoverInfoStats {
    const id = String(sessionId);
    const sessions = sessionsOf(ctx);
    const session = sessions?.get?.(id);
    if (!session) throw new RemoteError("hoverInfo/session-not-found", `session ${id} is not loaded live`, {});
    let view: HoverInfoView | undefined;
    try {
        const snap = projectionsOf(ctx)?.snapshot(session, ["hoverInfo"]);
        view = snap?.values.hoverInfo;
    } catch {
        throw new RemoteError("hoverInfo/not-loaded", `hoverInfo projection unavailable for session ${id}`, {});
    }
    if (!view) throw new RemoteError("hoverInfo/not-loaded", `hoverInfo projection unavailable for session ${id}`, {});
    const agents = agentsOf(ctx);
    let running = 0;
    for (const child of sessions.list()) {
        if (child.id === id) continue;
        if (child.header?.origin !== "subagent" || child.header?.parentSession !== id) continue;
        if (agents?.get?.(String(child.id))?.status === "running") running += 1;
    }
    return { ...view, subagentsRunning: running };
}
