/**
 * Host half — the user-settings schema.
 *
 * schemastery idiom: every field carries a default (the resolved snapshot is
 * always complete), so stored snapshots from earlier builds resolve unchanged.
 * There are no unions here.
 *
 * The host always serves every metric; toggling only changes what the browser
 * renders (docs/PLAN.md §4/§5.3), so config edits never invalidate client
 * caches.
 */
import z from "@deepseek-ai/schemastery";

/**
 * User-settings section: the `active` master switch, the `showPreviewTools`
 * sidebar-preview switch, the `showModelProvider` composer model-selector
 * switch, the `showJobKill` background-job kill switch, the `refreshMs` cache
 * TTL, and one boolean per metric row (docs/PLAN.md §4).
 */
export const SettingsSchema = z.object({
    /** Master switch; false disables the enhancer (stock card everywhere). */
    active: z.boolean().default(true),
    /** Sidebar file-preview header tools; false leaves the preview stock. */
    showPreviewTools: z.boolean().default(true),
    /** Composer model selector: `provider > model` in its tooltips; false
     *  leaves the standard selector's `title` untouched. */
    showModelProvider: z.boolean().default(true),
    /** Background-job list: a kill button on every live row; false leaves
     *  the stock job list untouched. */
    showJobKill: z.boolean().default(true),
    /** List/stats cache TTL in milliseconds (1 s … 60 s). */
    refreshMs: z.number().step(1).min(1000).max(60000).default(30000),
    showTurns: z.boolean().default(true),
    showSteps: z.boolean().default(true),
    showTokensIn: z.boolean().default(true),
    showTokensOut: z.boolean().default(true),
    showCompactions: z.boolean().default(true),
    showPurges: z.boolean().default(true),
    showContext: z.boolean().default(true),
    showSubagents: z.boolean().default(true),
    showModel: z.boolean().default(true),
    showToolCalls: z.boolean().default(false),
    showActiveTime: z.boolean().default(false),
    showCacheRead: z.boolean().default(false),
    showCreatedAt: z.boolean().default(false)
});

/** Resolved settings snapshot served to the browser (every field defaults). */
export type Settings = Schemastery.TypeT<typeof SettingsSchema>;

/**
 * The bundle row's config: today the same shape as the user-settings section,
 * because the row's config *is* the namespace's base layer (docs/PLAN.md
 * §5.3). A divergence would need a base-vs-user split here.
 */
export const Config = SettingsSchema;
