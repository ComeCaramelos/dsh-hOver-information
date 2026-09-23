/**
 * Browser half — the `apply` surface.
 *
 * Three cooperating pieces, all mounted from here (each fail-open, so a
 * missing shell service costs that half only):
 *
 * 1. The `hoverInfo` dictionaries — every string the enhancer and the card
 *    render.
 * 2. The Settings → Plugins card: master switch + refreshMs + one switch per
 *    metric row (see ../card/, ../controller/).
 * 3. The hover-card + document-preview enhancer (see ../enhancer/).
 *
 * `apply` composes the three disposers, mirroring the reference `apply.ts`:
 * registration stays unconditional (stock pattern) — the component itself
 * renders nothing until its namespace is served.
 */
import { DICTIONARIES } from "./locales/index.js";
import { LOCALE_NAMESPACE, SETTINGS_NAMESPACE } from "./plugin-meta.js";
import { applyEnhancer } from "./enhancer/index.js";
import { HoverInformationCardController } from "./controller/index.js";
import { HoverInformationCard } from "./card/card.js";
import { injectCardCss } from "./styles/index.js";

/** Mount every browser piece; returns a composite disposer. */
export function apply(ctx: any): () => void {
    const disposers = [];
    function collect(result: any): void {
        if (typeof result === "function") disposers.push(result);
    }
    try {
        collect(
            ctx.effect(function () {
                let off = noop;
                try {
                    off = ctx.locale.register(LOCALE_NAMESPACE, DICTIONARIES) || noop;
                } catch (error) {}
                return off;
            }, "hover-info: dictionaries")
        );
    } catch (error) {}
    if (ctx.slots && typeof ctx.slots.inject === "function" && ctx.settingsScope) {
        try {
            collect(applyCard(ctx));
        } catch (error) {}
    }
    try {
        collect(applyEnhancer(ctx));
    } catch (error) {}
    return function () {
        for (let i = 0; i < disposers.length; i++)
            try {
                disposers[i]();
            } catch (error) {}
    };
}

/** Mount the configuration card (CSS + controller + slot registration). */
function applyCard(ctx: any): () => void {
    let scope;
    try {
        scope = ctx.settingsScope.bind({ namespace: SETTINGS_NAMESPACE });
    } catch (error) {
        return noop;
    }
    if (typeof document !== "undefined") injectCardCss(document);
    const controller = new HoverInformationCardController(scope);
    const disposers = [];
    function collect(result: any): void {
        if (typeof result === "function") disposers.push(result);
    }
    collect(
        ctx.effect(
            function () {
                return function () {
                    controller.dispose();
                };
            },
            "hover-info: card controller"
        )
    );
    collect(
        ctx.effect(
            function () {
                return ctx.slots.inject("settings.plugin.item", function () {
                    return ctx.slots.register(
                        { name: "settings.plugin.item", key: SETTINGS_NAMESPACE, locale: LOCALE_NAMESPACE, inject: function () { return controller.inject(); } },
                        HoverInformationCard
                    );
                });
            },
            "hover-info: settings card"
        )
    );
    return function () {
        for (let i = 0; i < disposers.length; i++)
            try {
                disposers[i]();
            } catch (error) {}
    };
}

function noop(): void {}
