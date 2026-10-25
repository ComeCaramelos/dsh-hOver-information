/**
 * Host half — fixed identifiers.
 *
 * Since dsh 0.2.0 configuration lives on the **bundle row**: the card edits the
 * row's configuration form, and that form is keyed by the row's **profile entry
 * id** — no namespace of the host's own any more. The bundle id tags every DOM
 * node the browser half owns. The browser half is emitted as its own bundle and
 * cannot import this module, so `src/client/plugin-meta.ts` mirrors them — a
 * drift there breaks the card silently, so keep both sides in step.
 */

/** npm id of this bundle; tags the injected `style` elements and DOM nodes. */
export const PLUGIN_ID = "@comecaramelos/dsh-hover-information";

/**
 * Profile entry id this instance is keyed by: the bundle patch row's `id`, and
 * the key every configuration-form read and write goes through.
 */
export const ENTRY_ID = "hover-info";

/**
 * Every field of the row config (./schema.ts), all user-authored: the card
 * edits each one and nothing here is a live answer. test/host.test.mjs pins this
 * list against the compiled schema, so a field added there and not here fails.
 */
export const CONFIG_FIELDS: readonly string[] = [
    "showModelProvider",
    "refreshMs",
    "showTurns",
    "showSteps",
    "showTokensIn",
    "showTokensOut",
    "showCompactions",
    "showPurges",
    "showContext",
    "showSubagents",
    "showModel",
    "showToolCalls",
    "showActiveTime",
    "showCacheRead",
    "showCreatedAt"
];
