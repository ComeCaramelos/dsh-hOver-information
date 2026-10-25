/**
 * Host half — the single row-config `Config`.
 *
 * Since dsh 0.2.0 there is one persisted shape, not two: the bundle row's own
 * configuration, served to the browser as a configuration form keyed by the
 * row's profile entry id. There is no `settings.yaml` section to install and no
 * base layer to publish over — what the card edits and what the row config
 * carries are the same fields, read through the same references.
 *
 * Every field the card edits therefore carries `.volatile()`: a volatile field
 * is editable through the form **without remounting the plugin**, and the user
 * layer rides the profile patch. An entry that declares no volatile field
 * answers no form at all (`Plugin entry "<id>" has no volatile fields`), and a
 * write naming a non-volatile field is refused (`Config field "<path>" is not
 * volatile`) — so a field that stops being volatile is a GUI breakage this
 * schema is what pins (test/host.test.mjs pins the compiled surface).
 *
 * schemastery idiom: every field carries a default (the served section is
 * always complete), so a row that carries nothing answers the defaults from
 * earlier builds unchanged. There are no unions here.
 *
 * The host always serves every metric; toggling only changes what the browser
 * renders (docs/PLAN.md §4/§5.3), so config edits never invalidate client
 * caches — and, unlike the reference plugin, nothing here needs a live mirror:
 * what the Host answers is the fold, not the configuration.
 */
import z from "@deepseek-ai/schemastery";

/**
 * The row configuration. The composer model-selector switch
 * (`showModelProvider`), the cache TTL (`refreshMs`) and one boolean per metric
 * row — all volatile, all edited by the row's configuration page
 * (docs/PLAN.md §4).
 *
 * The sidebar-preview tools and the background-job kill used to be switches
 * here; both are shell-native since dsh 0.2.0, so both halves — and their
 * fields — are gone (docs/PLAN.md §39).
 *
 * The master `active` switch was one of them. It was the same answer the
 * Plugins page already gives for the bundle row itself: disabling the row never
 * runs `apply`, so the whole enhancement is already off without a second
 * switch (docs/PLAN.md §40). Nothing here stands in for that; what stays is
 * what no row affordance can express.
 */
export const Config = z.object({
    /** Composer model selector: `provider > model` in its tooltips; false
     *  leaves the standard selector's `title` untouched. */
    showModelProvider: z.boolean().default(true).volatile(),
    /** List/stats cache TTL in milliseconds (1 s … 60 s). */
    refreshMs: z.number().step(1).min(1000).max(60000).default(30000).volatile(),
    showTurns: z.boolean().default(true).volatile(),
    showSteps: z.boolean().default(true).volatile(),
    showTokensIn: z.boolean().default(true).volatile(),
    showTokensOut: z.boolean().default(true).volatile(),
    showCompactions: z.boolean().default(true).volatile(),
    showPurges: z.boolean().default(true).volatile(),
    showContext: z.boolean().default(true).volatile(),
    showSubagents: z.boolean().default(true).volatile(),
    showModel: z.boolean().default(true).volatile(),
    showToolCalls: z.boolean().default(false).volatile(),
    showActiveTime: z.boolean().default(false).volatile(),
    showCacheRead: z.boolean().default(false).volatile(),
    showCreatedAt: z.boolean().default(false).volatile()
});

/**
 * What one served form answers: every field as a plain value (`TypeS`, not
 * `TypeT`: a volatile field's *type* folds into a reference, its served answer
 * stays plain). Every field defaults, so the section is always complete.
 */
export type ConfigValues = Schemastery.TypeS<typeof Config>;
