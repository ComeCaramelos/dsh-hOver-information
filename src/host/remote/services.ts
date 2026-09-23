/**
 * Host half — the `hoverInfo` remote: host-service access.
 *
 * Every service lookup goes through `ctx.get` (never `ctx.<name>` property
 * access): property access on a plain-`new`ed Service fiber throws
 * `cannot get property "…" without inject`, while `ctx.get` resolves any
 * composed service. The lookups are all optional — an absent host service
 * degrades to `undefined`, never to an error.
 */
import type { PluginContext } from "../types/services.js";

/** Sessions service face, or undefined when the host does not mount one. */
export function sessionsOf(ctx: PluginContext): any {
    try {
        return ctx.get("sessions");
    } catch {
        return void 0;
    }
}

/** Live agent face that resolves a live session's running state. */
export function agentsOf(ctx: PluginContext): any {
    try {
        return ctx.get("agents");
    } catch {
        return void 0;
    }
}

/** Session-projection registry face, or undefined when absent. */
export function projectionsOf(ctx: PluginContext): any {
    try {
        return ctx.get("sessionProjections");
    } catch {
        return void 0;
    }
}

/**
 * Background-job registry face (`ctx.jobs`, mounted by
 * `@deepseek-ai/dsh-jobs-local` through the base profile), or undefined
 * when the composition does not mount one.
 */
export function jobsOf(ctx: PluginContext): any {
    try {
        return ctx.get("jobs");
    } catch {
        return void 0;
    }
}
