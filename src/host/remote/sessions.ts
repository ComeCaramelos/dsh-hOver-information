/**
 * Host half — the `hoverInfo` remote: live session rows for card matching.
 *
 * rc.2 facts this serves (verified against the installed harness;
 * docs/PLAN.md §8.1 spike):
 * - `sessions.list()` returns live `Session` instances with `id` and a
 *   `header` of `{ id, version, createdAt, cwd?, parentSession?, origin?, … }`
 *   — there is NO `header.title`/`header.updatedAt`/`header.model` field.
 * - Title comes from the `title` session projection (null until generated).
 * - Activity time is `max(header.createdAt, sessionListMetadata.lastPromptAt)`
 *   (the same formula `dsh-api-session-controller` uses).
 * - `running` comes from the live agent: `agents.get(id)?.status`.
 */
import { agentsOf, projectionsOf, sessionsOf } from "./services.js";
import type { HoverInfoSessionRow } from "../types/stats.js";
import type { PluginContext } from "../types/services.js";

/** One live session row (whole-field optional-tolerant, never throws). */
export function sessionRowOf(ctx: PluginContext, session: any): HoverInfoSessionRow {
    let title: string | null = null;
    let lastPromptAt: number | null = null;
    try {
        const snap = projectionsOf(ctx)?.snapshot(session, ["title", "sessionListMetadata"]);
        title = snap?.values.title ?? null;
        lastPromptAt = snap?.values.sessionListMetadata?.lastPromptAt ?? null;
    } catch {
        // A projection not being registered is not fatal here: the row falls
        // back to createdAt and a null title.
    }
    return {
        id: String(session.id),
        title: typeof title === "string" ? title : null,
        updatedAt: Math.max(
            typeof session.header?.createdAt === "number" ? session.header.createdAt : 0,
            typeof lastPromptAt === "number" ? lastPromptAt : 0
        ),
        running: agentsOf(ctx)?.get?.(String(session.id))?.status === "running",
        cwd: typeof session.header?.cwd === "string" ? session.header.cwd : null,
        createdAt: typeof session.header?.createdAt === "number" ? session.header.createdAt : null
    };
}

/** The live sidebar rows served to the browser (docs/PLAN.md §6.2). */
export function sessionRows(ctx: PluginContext): HoverInfoSessionRow[] {
    const sessions = sessionsOf(ctx);
    if (!sessions) return [];
    const rows: HoverInfoSessionRow[] = [];
    for (const session of sessions.list()) rows.push(sessionRowOf(ctx, session));
    return rows;
}
