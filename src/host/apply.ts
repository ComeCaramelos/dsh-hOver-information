/**
 * Host half — the wiring.
 *
 * Mounts three things behind one `hover-info` plugin row:
 *
 * 1. The `hover-info` settings namespace (`./settings.ts`) — base layer = the
 *    bundle row's config, edited by the Settings → Plugins card (docs/PLAN.md
 *    §4/§5.3). Every field defaults, so stored snapshots from earlier builds
 *    resolve unchanged.
 * 2. The `hoverInfo` session-projection unit (`./projection/`) — the pure fold
 *    of each session's durable log that backs the hover-card metrics block.
 * 3. The `hoverInfo` Typert remote (`./remote/`) — browser endpoints `sessions()`
 *    (live list for card matching) and `stats(sessionId)`.
 *
 * The host always serves every metric; toggling only changes what the browser
 * renders, so config edits never invalidate client caches.
 *
 * One plugin instance per dsh host: the settings namespace is fixed.
 */
import type { Context } from "@deepseek-ai/cordis";
import { installSettingsSection } from "./settings.js";
import { HoverInfoRemote } from "./remote/index.js";
import { hoverInfoProjectionDefinition } from "./projection/index.js";
import type { Settings } from "./schema.js";
import type { PluginContext, ProjectionRegistry } from "./types/index.js";

/**
 * Install the settings section, register the projection unit, and mount the
 * Typert remote.
 *
 * @param ctx - plugin context.
 * @param config - validated base layer (the bundle patch row's config).
 */
export function apply(ctx: PluginContext, config: Settings): void {
    installSettingsSection(ctx, config);
    // Optional mount: without a projection registry there are no metrics to
    // fold, so registration is kept optional (fail-open) instead of making
    // the whole plugin row unresolvable.
    ctx.inject(["sessionProjections"], (projectionCtx: Context) => {
        (projectionCtx as unknown as { sessionProjections: ProjectionRegistry }).sessionProjections.register(hoverInfoProjectionDefinition());
    });
    new HoverInfoRemote(ctx);
}
