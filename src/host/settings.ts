/**
 * Host half — the `hover-info` settings section.
 *
 * Installs the namespace the Settings → Plugins card edits: the bundle row's
 * validated config is the base layer, and every field of the user section falls
 * back to it (docs/PLAN.md §4/§5.3). No host-side consumer of the resolved
 * value is needed: it reaches the browser through the `settingsScope` snapshot
 * the client half binds to, and the remote always serves every metric, so
 * toggles never invalidate client caches.
 */
import type { Context } from "@deepseek-ai/cordis";
import { SETTINGS_NAMESPACE } from "./constants.js";
import { SettingsSchema } from "./schema.js";
import type { Settings } from "./schema.js";
import type { PluginContext, SettingsService } from "./types/index.js";

/**
 * Publish the `hover-info` namespace over `config` as its base layer.
 *
 * @param ctx - plugin context (the `settings` inject resolves its service).
 * @param config - validated base layer (the bundle row's config).
 */
export function installSettingsSection(ctx: PluginContext, config: Settings): void {
    ctx.inject(["settings"], (settingsCtx: Context) => {
        (settingsCtx as unknown as { settings: SettingsService }).settings.installSection(ctx, SETTINGS_NAMESPACE, SettingsSchema, config, {
            setSource: () => {
                // The live resolved value reaches the browser through the
                // settingsScope snapshot; no host-side consumer is needed
                // (the remote always serves every metric).
            },
            onChange: () => {}
        });
    });
}
