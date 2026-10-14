/**
 * Host half — the row's configuration form.
 *
 * Since dsh 0.2.0 the card edits the **bundle row's own configuration**, served
 * as a profile configuration form keyed by the row's profile entry id: one
 * `Config` (./schema.ts), the row config as its base layer, and the profile
 * patch as its user layer. `settings.yaml` is gone, so there is no namespace to
 * install and no base layer to publish.
 *
 * The machinery is `@comecaramelos/dsh-ancesters`' `attachSettingsForm`, which
 * owns the three invariants every card needs (identity read off this fiber's own
 * loader entry, the generated page kept off with one disposable
 * `settings.configure({ auto: false }, fiber)` per fiber, and commit routing by
 * field). What is declared here is only this row's shape:
 *
 * - **Every field is user-authored** (`CONFIG_FIELDS`), and there is **no live
 *   mirror** (`liveKeys: []`): what the Host answers is the fold, not the
 *   configuration.
 * - **No commit routing and no triggers**: the host serves every metric
 *   regardless of configuration (docs/PLAN.md §4/§5.3), so a form commit
 *   changes what the browser renders and nothing the host answers.
 */
import { attachSettingsForm, requireEntryId, type AdapterContext } from "@comecaramelos/dsh-ancesters/host";
import { CONFIG_FIELDS } from "./constants.js";
import type { PluginContext } from "./types/index.js";

/**
 * The profile entry id this instance is keyed by, read off its own loader entry.
 * Throws when the plugin was not started as a profile entry: the id is the key
 * every read and write goes through, so inventing one would alias (or silently
 * address nothing) instead of failing loud.
 *
 * @param ctx - plugin context.
 */
export function hoverInfoEntryId(ctx: PluginContext): string {
    return requireEntryId(ctx as unknown as Parameters<typeof requireEntryId>[0]);
}

/**
 * Attach this row's configuration form for as long as this instance lives (the
 * form, and the generated page it keeps off, dispose with the fiber).
 *
 * @param ctx - plugin context.
 */
export function installHoverInfoForm(ctx: PluginContext): void {
    attachSettingsForm(ctx as unknown as AdapterContext, {
        name: "hover-info",
        userFields: CONFIG_FIELDS,
        liveKeys: []
    });
}
