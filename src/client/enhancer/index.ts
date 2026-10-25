/**
 * Browser half — the enhancer mount.
 *
 * Watches `document.body` for the stock session hover-card portal (structural
 * fingerprint — see ./detect.ts), enhances it (./hover-card.ts), and drives the
 * whole surface through one lazy sweep: the heartbeat starts with the first open
 * card and stops with the last (docs/ROADMAP.md Fase 2b), so an idle tab keeps
 * no wakeups.
 *
 * The composer model-selector surface (./model.ts) is also driven from here: it
 * rides its own DOM records plus the live directory-store subscription, with
 * the sweep heartbeat standing behind it as the DOM-source backstop.
 *
 * This is also the only module that owns the per-mount state: `env` is handed
 * to every component call and is built here, once, per `apply`.
 */
import { DEFAULT_REFRESH_MS, MODEL_SEAT_ATTR, SWEEP_INTERVAL_MS } from "../constants.js";
import { METRICS } from "../metrics.js";
import { ENTRY_ID } from "../plugin-meta.js";
import { isHoverCard } from "./detect.js";
import { cleanupCard, enhanceCard, stripCard, syncCard } from "./hover-card.js";
import { clearModelStoreSubscriptions, mentionsModelSurface, modelSurfaceMentionsIn, restoreAllModelTexts, restoreAllModelTitles, syncModelSelectors } from "./model.js";
import { injectHoverCss } from "../styles/index.js";
import type { EnhancerEnv } from "./env.js";

/** Mount the enhancer; returns the dispose. */
export function applyEnhancer(ctx: any): () => void {
    return ctx.effect(function () {
        const doc = typeof document !== "undefined" ? document : undefined;
        const win = typeof window !== "undefined" ? window : undefined;
        if (!doc || !win || typeof win.MutationObserver !== "function") return noop;

        /** Live card elements → their state; every DOM node we own hangs here. */
        const cards: EnhancerEnv["cards"] = new Map();
        /** Session id → the last live-stats view + freshness. */
        const statsCache: EnhancerEnv["statsCache"] = new Map();
        const metricEnabled: Record<string, boolean> = {};
        for (const row of METRICS) metricEnabled[row.field] = !(row.field === "showToolCalls" || row.field === "showActiveTime" || row.field === "showCacheRead" || row.field === "showCreatedAt");

        const env: EnhancerEnv = {
            doc,
            win,
            ctx,
            cards,
            statsCache,
            metricEnabled,
            modelProviderEnabled: true,
            modelTitles: new Map(),
            modelTexts: new Map(),
            modelSubs: new Map(),
            modelSyncing: false,
            refreshMs: DEFAULT_REFRESH_MS,
            startSweep: () => startSweep(),
            stopSweep: () => stopSweep(),
            refreshAllCards: () => refreshAllCards()
        };

        /** The row configuration: refreshMs, row enablement — read off the
         * row's configuration form, the same source the configuration page
         * writes through (dsh 0.2.0 has no scope binding). */
        let unsubscribeScope = noop;
        try {
            const form = ctx.configForms.get(ENTRY_ID);
            const readScope = function () {
                const snapshot = form.getSnapshot();
                if (snapshot && snapshot.status === "ready" && snapshot.value) {
                    const value = snapshot.value;
                    if (value.showModelProvider !== void 0) env.modelProviderEnabled = value.showModelProvider !== false;
                    const ms = Number(value.refreshMs);
                    env.refreshMs = Number.isFinite(ms) && ms >= 1000 && ms <= 60000 ? ms : DEFAULT_REFRESH_MS;
                    for (let k = 0; k < METRICS.length; k++) {
                        const field = METRICS[k].field;
                        if (value[field] !== void 0) env.metricEnabled[field] = value[field] === true;
                    }
                }
                refreshAllCards();
                // The model-provider switch toggles live: off restores the
                // whole selector surface, on re-seats every title.
                try {
                    syncModelSelectors(env);
                } catch (error) {}
            };
            unsubscribeScope = form.subscribe(readScope) || noop;
            readScope();
        } catch (error) {
            env.modelProviderEnabled = true;
        }

        const disposeCss = injectHoverCss(doc);

        function refreshAllCards(): void {
            cards.forEach(function (state) {
                try {
                    syncCard(env, state);
                } catch (error) {}
            });
        }

        // The heartbeat exists only while at least one card is open; the
        // handle is unref'd so a forgotten `dispose` in tests can never hold
        // the process alive (`unref` exists only in Node; browser handles are
        // numbers, hence the structural check).
        let sweepTimer: any = null;

        function sweepTick(): void {
            try {
                if (cards.size === 0) {
                    stopSweep();
                    return;
                }
                // The heartbeat only runs while a card is open: a detached
                // card loses its state, a live one re-syncs (the diff-guarded
                // path costs nothing when nothing moved).
                cards.forEach(function (state) {
                    if (!state.cardEl.isConnected) cleanupCard(env, state.cardEl);
                    else syncCard(env, state);
                });
                // Selector backstop: the DOM-source resolution (an open
                // model-list's checked option) has no subscription to ride.
                try {
                    syncModelSelectors(env);
                } catch (error) {}
                if (cards.size === 0) stopSweep();
            } catch (error) {}
        }

        function startSweep(): void {
            if (sweepTimer !== null || cards.size === 0) return;
            sweepTimer = win.setInterval(sweepTick, SWEEP_INTERVAL_MS);
            if (sweepTimer !== null && typeof sweepTimer.unref === "function") sweepTimer.unref();
        }

        function stopSweep(): void {
            if (sweepTimer === null) return;
            const timer = sweepTimer;
            sweepTimer = null;
            try {
                win.clearInterval(timer);
            } catch (error) {}
        }

        const bodyObserver = new win.MutationObserver(function (records) {
            try {
                for (let r = 0; r < records.length; r++) {
                    const record = records[r] as any;
                    // Records may carry only one kind; tolerate the others
                    // (attribute records arrive here in the DOM stub, never in
                    // browsers). A removed card loses its state whatever the
                    // record carried it under.
                    const removedNodes = record.removedNodes || [];
                    for (let removed = 0; removed < removedNodes.length; removed++) cleanupCard(env, removedNodes[removed]);
                    const addedNodes = record.addedNodes || [];
                    for (let added = 0; added < addedNodes.length; added++) {
                        const node = addedNodes[added];
                        if (!isHoverCard(doc, win, node)) continue;
                        if (node.nodeType === 1 && cards.has(node)) continue;
                        enhanceCard(env, node);
                    }
                }
            } catch (error) {
                console.warn("hover-info: hover-card enhance skipped:", error);
            }
        });
        bodyObserver.observe(doc.body, { childList: true });

        // Model-selector discovery (docs/PLAN.md §33). The composer trigger
        // lives inside the named seat; the menu is a body-level portal, so
        // childList records catch its mount and attribute records catch the
        // shell rewriting the trigger's stock `title`. Every record is gated
        // by a mention probe so the streaming chat DOM stays cheap; selection
        // changes that touch no DOM attribute reach the sync through the
        // directory-store subscription wired in ./model.js.
        const modelObserver = new win.MutationObserver(function (records) {
            try {
                for (let r = 0; r < records.length; r++) {
                    const record = records[r] as any;
                    if (!record) continue;
                    let dirty = false;
                    if (record.type === "attributes") {
                        dirty = mentionsModelSurface(record.target);
                    } else if (record.type === "characterData") {
                        // A text node changed in place — that is how React
                        // rewrites a `cellValue` label. Its owning element
                        // answers for the surface.
                        const owner = record.target && (record.target.parentElement || record.target);
                        dirty = mentionsModelSurface(owner);
                    } else {
                        // childList — and the record kinds that carry no
                        // additions (the DOM stub omits `type` entirely).
                        const removed = record.removedNodes || [];
                        for (let n = 0; n < removed.length && !dirty; n++) dirty = mentionsModelSurface(removed[n]);
                        const added = record.addedNodes || [];
                        for (let n = 0; n < added.length && !dirty; n++) dirty = modelSurfaceMentionsIn(added[n], 64);
                    }
                    if (dirty) {
                        syncModelSelectors(env);
                        return;
                    }
                }
            } catch (error) {
                console.warn("hover-info: model selector sync skipped:", error);
            }
        });
        modelObserver.observe(doc.body, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true,
            attributeFilter: ["title", "role", "aria-checked", MODEL_SEAT_ATTR]
        });

        // A conversation already open at mount time fired no records — one
        // sync pass catches the reloaded-session case.
        try {
            syncModelSelectors(env);
        } catch (error) {}

        return function dispose(): void {
            try {
                bodyObserver.disconnect();
            } catch (error) {}
            try {
                modelObserver.disconnect();
            } catch (error) {}
            try {
                clearModelStoreSubscriptions(env);
            } catch (error) {}
            try {
                restoreAllModelTitles(env);
            } catch (error) {}
            try {
                restoreAllModelTexts(env);
            } catch (error) {}
            try {
                stopSweep();
            } catch (error) {}
            cards.forEach(function (state) {
                if (state.observer) state.observer.disconnect();
                for (let i = 0; i < state.timers.length; i++) win.clearTimeout(state.timers[i]);
            });
            // This mount is the only owner of what it injected, so its last
            // act is handing every open card back to the shell. That is what
            // "off" now means: not a switch inside the configuration, but the
            // Plugins page disabling this bundle's own row (docs/PLAN.md §40)
            // — which unmounts this half, so the stock card must survive it.
            cards.forEach(function (state) {
                if (state.cardEl.isConnected) stripCard(env, state);
            });
            cards.clear();
            statsCache.clear();
            unsubscribeScope();
            disposeCss();
        };
    }, "hover-info: hover-card enhancer");
}

function noop(): void {}
