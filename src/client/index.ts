/**
 * Browser half — the public surface and the `apply` composition.
 *
 * Two planes, mounted side by side (each fail-open, so a missing shell service
 * costs that half only):
 *
 * 1. **The configuration card**, built from `@comecaramelos/dsh-ancesters`'
 *    `mountSettingsCard`: the shared styles, the `hoverInfo` dictionaries
 *    (merged over the shared namespace), the controller over the row's
 *    configuration form and the slot registration all come from the shared
 *    half. The card stands on the **bundle's own page** (`placement: "bundle"`
 *    → `plugins.bundle.config`, keyed by the package name): clicking the plugin
 *    in the Plugins list opens the form directly, the way the built-in Web
 *    search entry does, with no step into the `hover-info` component. What is
 *    declared here is the descriptor — every field immediate, no mirror, no
 *    triggers — and the one block it draws (see ./card/body.ts). Whether the
 *    enhancement runs at all is what the Plugins page answers with the
 *    bundle's own enable, not a field here (docs/PLAN.md §40).
 * 2. **The hover-card enhancer** (see ./enhancer/): another plane, untouched by
 *    the card — it reads the same form and renders through the same
 *    dictionaries, and nothing of the card mounts outside its page slot.
 *
 * The two budgets are exported because the browser-side cache TTL is pinned
 * against them by tests.
 */
import { mountSettingsCard } from "@comecaramelos/dsh-ancesters/client";
import { bindBody, HoverInformationBlock } from "./card/body.js";
import { DICTIONARIES } from "./locales/index.js";
import { ENTRY_ID, LOCALE_NAMESPACE, PLUGIN_ID } from "./plugin-meta.js";
import { applyEnhancer } from "./enhancer/index.js";
import { injectCardCss } from "./styles/index.js";

/** The descriptor that makes this plugin's configuration card. */
export const card = mountSettingsCard({
    entryId: ENTRY_ID,
    pluginId: PLUGIN_ID,
    localeNamespace: LOCALE_NAMESPACE,
    locale: DICTIONARIES,
    fields: {
        staged: [],
        immediate: [
            "showModelProvider", "refreshMs", "showTurns", "showSteps",
            "showTokensIn", "showTokensOut", "showCompactions", "showPurges",
            "showContext", "showSubagents", "showModel", "showToolCalls",
            "showActiveTime", "showCacheRead", "showCreatedAt"
        ],
        triggers: [],
        // No mirror: every field is editable, and nothing the Host answers
        // rides the form.
        liveKeys: []
    },
    blocks: [
        {
            block: HoverInformationBlock as never,
            hideWhenUnavailable: true,
            bind: (snapshot: any, controller: any) => bindBody(snapshot, controller)
        }
    ],
    // The bundle's page is what the Plugins list opens. It asks for the `page`
    // shape only: the line under the title is the package description.
    placement: "bundle"
});

/**
 * Services the shell must resolve before `apply` runs: the card's own set plus
 * the enhancer's — the sessions store (identity + the `hoverInfo` projection
 * hint) and the connection (the RPC envelope the stats live fetch rides).
 */
export const inject: readonly string[] = ["sessions", "connection", ...card.inject.filter((name) => name !== "sessions" && name !== "connection")];

/** Mount both planes; returns the enhancer's disposer (the card's own effects
 * dispose with the fiber). */
export function apply(ctx: any): () => void {
    if (ctx.slots && typeof ctx.slots.inject === "function") {
        try {
            if (typeof document !== "undefined") injectCardCss(document);
            card.apply(ctx);
        } catch (error) {}
    } else {
        // No row slot, no card — but the enhancer still renders through the
        // `hoverInfo` dictionaries, which the card would otherwise register.
        try {
            ctx.effect(function () {
                return ctx.locale.register(LOCALE_NAMESPACE, DICTIONARIES);
            }, "hover-info: dictionaries");
        } catch (error) {}
    }
    let dispose: () => void = noop;
    try {
        const result = applyEnhancer(ctx);
        if (typeof result === "function") dispose = result;
    } catch (error) {}
    return dispose;
}

/** Cache budgets pinned against host defaults by test/client.test.mjs. */
export { DEFAULT_REFRESH_MS, FAILURE_RETRY_MS } from "./constants.js";
/** The block's projection + write doors, driven directly by test/client.test.mjs. */
export { bindBody };

function noop(): void {}
