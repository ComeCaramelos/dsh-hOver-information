/**
 * @comecaramelos/dsh-hover-information — host half.
 *
 * Mounts three things behind one `hover-info` plugin row:
 *
 * 1. The `hover-info` settings namespace (base layer = the bundle row's
 *    config) edited by the Settings → Plugins card in ./client.js: the
 *    `active` master switch, the `refreshMs` cache TTL, and one boolean per
 *    metric row (docs/PLAN.md §4/§5.3). Every field defaults, so stored
 *    snapshots from earlier builds resolve unchanged.
 * 2. The `hoverInfo` session-projection unit (./unit.js) — the pure fold of
 *    each session's durable log that backs the hover-card metrics block.
 * 3. The `hoverInfo` Typert remote (./remote.js) — browser endpoints
 *    `sessions()` (live list for card matching) and `stats(sessionId)`.
 *
 * The host always serves every metric; toggling only changes what the
 * browser renders, so config edits never invalidate client caches.
 */
import z from "@deepseek-ai/schemastery";
import { HoverInfoRemote } from "./remote.js";
import { hoverInfoProjectionDefinition } from "./unit.js";

/** Cordis plugin name used by loader diagnostics. */
const name = "hover-info";

/** Settings namespace served to the browser. */
const SETTINGS_NAMESPACE = "hover-info";

/** Host services the plugin resolves before applying. */
const inject = ["settings"];

/**
 * User-settings section. schemastery idiom: every field carries a default
 * (the resolved snapshot is always complete); there are no unions here.
 */
export const SettingsSchema = z.object({
	/** Master switch; false disables the enhancer (stock card everywhere). */
	active: z.boolean().default(true),
	/** List/stats cache TTL in milliseconds (1 s … 60 s). */
	refreshMs: z.number().step(1).min(1000).max(60000).default(30000),
	showTurns: z.boolean().default(true),
	showSteps: z.boolean().default(true),
	showTokensIn: z.boolean().default(true),
	showTokensOut: z.boolean().default(true),
	showCompactions: z.boolean().default(true),
	showContext: z.boolean().default(true),
	showSubagents: z.boolean().default(true),
	showModel: z.boolean().default(true),
	showToolCalls: z.boolean().default(false),
	showActiveTime: z.boolean().default(false),
	showCacheRead: z.boolean().default(false),
	showCreatedAt: z.boolean().default(false)
});

export const Config = SettingsSchema;

/**
 * Install the settings section, register the projection unit, and mount the
 * Typert remote.
 *
 * @param ctx - plugin context.
 * @param config - validated base layer (the bundle patch row's config).
 */
function apply(ctx, config) {
	ctx.inject(["settings"], (settingsCtx) => {
		settingsCtx.settings.installSection(ctx, SETTINGS_NAMESPACE, SettingsSchema, config, {
			setSource: () => {
				// The live resolved value reaches the browser through the
				// settingsScope snapshot; no host-side consumer is needed
				// (the remote always serves every metric).
			},
			onChange: () => {}
		});
	});
	// Optional mount: without a projection registry there are no metrics to
	// fold, so registration is kept optional (fail-open) instead of making
	// the whole plugin row unresolvable.
	ctx.inject(["sessionProjections"], (projectionCtx) => {
		projectionCtx.sessionProjections.register(hoverInfoProjectionDefinition());
	});
	new HoverInfoRemote(ctx);
}

export { apply, inject, name, SETTINGS_NAMESPACE };
