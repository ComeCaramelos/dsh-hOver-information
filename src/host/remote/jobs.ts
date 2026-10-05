/**
 * Host half — the `hoverInfo` remote: one background-job kill.
 *
 * The registry itself is the base-profile `ctx.jobs`
 * (`@deepseek-ai/dsh-jobs-local`'s `LocalJobRegistry`); its `kill(id,
 * caller)` checks the caller against the job owner, so the request carries
 * the owning session id and the live agent (same call shape `job_kill`
 * makes: `ctx.jobs.kill(id, exec.agent, reason)`).
 *
 * A kill request is not a force: the registry flips the record to
 * `stopping`, cancels the producer and lets the row settle as `killed` —
 * the settled row itself is what tells the browser button to drop.
 */
import { RemoteError } from "@deepseek-ai/dsh-typert-protocol";
import { agentsOf, jobsOf } from "./services.js";
import type { PluginContext } from "../types/services.js";

/** What one kill call decided. `already-finished` = the row is already settled. */
export interface HoverInfoKillResult {
    outcome: "requested" | "already-finished";
}

/**
 * Cancel one live background job owned by one live session.
 *
 * @throws RemoteError `hoverInfo/jobs-unavailable` when the host composes no
 *   job registry, `hoverInfo/session-not-found` when the owning session is
 *   not live (every owned job needs its agent as the access-check caller),
 *   `hoverInfo/job-not-found` when the id is unknown or belongs to another
 *   session (the browser treats every code as "no action" — fail-open, the
 *   row is untouched).
 */
export function killJobFor(ctx: PluginContext, sessionId: string, jobId: string): HoverInfoKillResult {
    const jobs = jobsOf(ctx);
    if (!jobs || typeof jobs.kill !== "function") {
        throw new RemoteError("hoverInfo/jobs-unavailable", "this host composes no background-job registry", {});
    }
    const id = String(sessionId);
    const agent = agentsOf(ctx)?.get?.(id);
    if (!agent) throw new RemoteError("hoverInfo/session-not-found", `session ${id} is not live`, {});
    let outcome: string;
    try {
        outcome = String(jobs.kill(String(jobId), agent));
    } catch (error) {
        throw new RemoteError(
            "hoverInfo/job-not-found",
            `cannot kill job ${String(jobId)} of session ${id}: ${String(error)}`,
            {}
        );
    }
    return { outcome: outcome === "already-finished" ? "already-finished" : "requested" };
}
