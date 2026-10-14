/**
 * Host half — the wiring.
 *
 * Mounts three things behind one `hover-info` plugin row:
 *
 * 1. The row's configuration form (`./settings.ts`) — the bundle row's own
 *    configuration, served to the browser as a profile configuration form and
 *    edited by the row's configuration page (docs/PLAN.md §4/§5.3). Since
 *    dsh 0.2.0 there is no namespace to install: the row config is the form's
 *    base layer, and every edit lands in the profile patch.
 * 2. The `hoverInfo` session-projection unit (`./projection/`) — the pure fold
 *    of each session's durable log that backs the hover-card metrics block.
 * 3. The `hoverInfo` Typert remote (`./remote/`) — browser endpoints `sessions()`
 *    (live list for card matching) and `stats(sessionId)`.
 *
 * The host always serves every metric; toggling only changes what the browser
 * renders, so config edits never invalidate client caches — and, because
 * nothing here reads the configuration back, a form commit needs no routing
 * (contrast the reference plugin, whose commit routes into its bridge).
 *
 * One plugin instance per dsh host: the row's entry id is fixed.
 */
import type { Context } from "@deepseek-ai/cordis";
import { installHoverInfoForm } from "./settings.js";
import { HoverInfoRemote } from "./remote/index.js";
import { hoverInfoProjectionDefinition } from "./projection/index.js";
import type { HoverInfoConfig } from "./types/config.js";
import type { PluginContext, ProjectionRegistry } from "./types/index.js";

/**
 * Attach the configuration form, register the projection unit, and mount the
 * Typert remote.
 *
 * @param ctx - plugin context.
 * @param config - the validated row config. **Nothing consumes it**: every field
 * is `.volatile()` (so `apply` receives it as live references), and the host
 * answers every metric regardless of what it holds — the browser reads the same
 * values off the configuration form. It is kept in the signature because that is
 * what the loader hands a plugin row.
 */
export function apply(ctx: PluginContext, config?: HoverInfoConfig): void {
    void config;
    installHoverInfoForm(ctx);
    // Optional mount: without a projection registry there are no metrics to
    // fold, so registration is kept optional (fail-open) instead of making
    // the whole plugin row unresolvable.
    ctx.inject(["sessionProjections"], (projectionCtx: Context) => {
        (projectionCtx as unknown as { sessionProjections: ProjectionRegistry }).sessionProjections.register(hoverInfoProjectionDefinition());
    });
    new HoverInfoRemote(ctx);
}
