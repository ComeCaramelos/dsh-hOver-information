/**
 * Browser half — the enhancer mount.
 *
 * Watches `document.body` for the stock session hover-card portal (structural
 * fingerprint — see ./detect.ts), enhances it (./hover-card.ts), watches for
 * the stock document-preview root (see ./preview.ts), and drives both through
 * one lazy sweep: the heartbeat starts with the first open card/preview and
 * stops with the last (docs/ROADMAP.md Fase 2b), so an idle tab keeps no
 * wakeups.
 *
 * This is also the only module that owns the per-mount state: `env` is handed
 * to every component call and is built here, once, per `apply`.
 */
import { DEFAULT_REFRESH_MS, MODEL_SEAT_ATTR, SWEEP_INTERVAL_MS } from "../constants.js";
import { PREVIEW_PATH_ATTR, PREVIEW_ROOT_ATTR } from "../constants.js";
import { METRICS } from "../metrics.js";
import { SETTINGS_NAMESPACE } from "../plugin-meta.js";
import { isHoverCard } from "./detect.js";
import { cleanupCard, enhanceCard, syncCard } from "./hover-card.js";
import { clearModelStoreSubscriptions, mentionsModelSurface, modelSurfaceMentionsIn, restoreAllModelTexts, restoreAllModelTitles, syncModelSelectors } from "./model.js";
import { cleanupPreview, enhancePreview, findByAttributeIn, previewRootOf, syncPreview } from "./preview.js";
import { cleanupAllJobMenus, cleanupJobMenu, enhanceJobMenu, findJobMenusIn, isJobMenu, jobMenuLabel, mentionsJobMenu, syncJobMenu } from "./jobs.js";
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
        /** Preview root elements → their state. */
        const previews: EnhancerEnv["previews"] = new Map();
        /** Background-job menu elements → their state (open `ul` menus). */
        const jobMenus: EnhancerEnv["jobMenus"] = new Map();
        /** Session id → the last live-stats view + freshness. */
        const statsCache: EnhancerEnv["statsCache"] = new Map();
        const metricEnabled: Record<string, boolean> = {};
        for (const row of METRICS) metricEnabled[row.field] = !(row.field === "showToolCalls" || row.field === "showActiveTime" || row.field === "showCacheRead" || row.field === "showCreatedAt");

        const env: EnhancerEnv = {
            doc,
            win,
            ctx,
            cards,
            previews,
            jobMenus,
            statsCache,
            metricEnabled,
            active: true,
            previewToolsEnabled: true,
            modelProviderEnabled: true,
            jobKillEnabled: true,
            modelTitles: new Map(),
            modelTexts: new Map(),
            modelSubs: new Map(),
            modelSyncing: false,
            refreshMs: DEFAULT_REFRESH_MS,
            startSweep: () => startSweep(),
            stopSweep: () => stopSweep(),
            refreshAllCards: () => refreshAllCards()
        };

        /** Settings-scoped: master switch, preview-tools switch, refreshMs, row enablement. */
        let unsubscribeScope = noop;
        try {
            const scope = ctx.settingsScope.bind({ namespace: SETTINGS_NAMESPACE });
            const readScope = function () {
                const snapshot = scope.getSnapshot();
                if (snapshot && snapshot.status === "ready" && snapshot.value) {
                    const value = snapshot.value;
                    if (value.active !== void 0) env.active = value.active !== false;
                    if (value.showPreviewTools !== void 0) env.previewToolsEnabled = value.showPreviewTools !== false;
                    if (value.showModelProvider !== void 0) env.modelProviderEnabled = value.showModelProvider !== false;
                    if (value.showJobKill !== void 0) env.jobKillEnabled = value.showJobKill !== false;
                    const ms = Number(value.refreshMs);
                    env.refreshMs = Number.isFinite(ms) && ms >= 1000 && ms <= 60000 ? ms : DEFAULT_REFRESH_MS;
                    for (let k = 0; k < METRICS.length; k++) {
                        const field = METRICS[k].field;
                        if (value[field] !== void 0) env.metricEnabled[field] = value[field] === true;
                    }
                }
                refreshAllCards();
                // The preview-tools switch toggles live: every open preview
                // re-syncs immediately — the diff-only resync detaches the bar
                // while off and re-seats it once re-enabled.
                previews.forEach(function (state) {
                    try {
                        syncPreview(env, state);
                    } catch (error) {}
                });
                // The model-provider switch toggles live too: off restores the
                // whole selector surface, on re-seats every title.
                try {
                    syncModelSelectors(env);
                } catch (error) {}
                // The background-job kill switch is live as well: off strips
                // every mounted menu's buttons, on re-seats them.
                jobMenus.forEach(function (state) {
                    try {
                        syncJobMenu(env, state);
                    } catch (error) {}
                });
            };
            unsubscribeScope = scope.subscribe(readScope) || noop;
            readScope();
        } catch (error) {
            env.active = true;
            env.previewToolsEnabled = true;
        }

        const disposeCss = injectHoverCss(doc);

        function refreshAllCards(): void {
            cards.forEach(function (state) {
                try {
                    syncCard(env, state);
                } catch (error) {}
            });
        }

        // The heartbeat exists only while at least one card/preview/menu is
        // open; the handle is unref'd so a forgotten `dispose` in tests can
        // never hold the process alive (`unref` exists only in Node; browser
        // handles are numbers, hence the structural check).
        let sweepTimer: any = null;

        function sweepTick(): void {
            try {
                if (cards.size === 0 && previews.size === 0 && jobMenus.size === 0) {
                    stopSweep();
                    return;
                }
                if (!env.active) return;
                cards.forEach(function (state) {
                    if (!state.cardEl.isConnected) cleanupCard(env, state.cardEl);
                    else syncCard(env, state);
                });
                previews.forEach(function (state, rootEl) {
                    if (!rootEl.isConnected) cleanupPreview(env, rootEl);
                    else syncPreview(env, state);
                });
                // Menu backstop: the per-menu observer carries React's churn;
                // this one catches a detached root a record never reported.
                jobMenus.forEach(function (state, ulEl) {
                    if (!ulEl.isConnected) cleanupJobMenu(env, ulEl, state);
                    else syncJobMenu(env, state);
                });
                // Selector backstop: the DOM-source resolution (an open
                // model-list's checked option) has no subscription to ride.
                try {
                    syncModelSelectors(env);
                } catch (error) {}
                if (cards.size === 0 && previews.size === 0 && jobMenus.size === 0) stopSweep();
            } catch (error) {}
        }

        function startSweep(): void {
            if (sweepTimer !== null || (cards.size === 0 && previews.size === 0 && jobMenus.size === 0)) return;
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
                if (!env.active) return;
                for (let r = 0; r < records.length; r++) {
                    const record = records[r] as any;
                    // Records may carry only one kind; tolerate the others
                    // (attribute records arrive here in the DOM stub, never in
                    // browsers).
                    const removedNodes = record.removedNodes || [];
                    for (let removed = 0; removed < removedNodes.length; removed++) cleanupCard(env, removedNodes[removed]);
                    if (!env.active) return;
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

        // Preview discovery. A file opening MOUNTS the preview DOM somewhere
        // inside the body subtree — and its anchor attributes arrive *with*
        // the elements they are stamped on, so an attribute record can never
        // fire for a fresh mount; childList records catch the mount, and
        // attribute records stay for a re-keyed path element. Chat churn is
        // kept cheap by scanning only added subtrees with a budget, after O(1)
        // attribute probes.
        const previewObserver = new win.MutationObserver(function (records) {
            try {
                if (!env.active) return;
                for (let r = 0; r < records.length; r++) {
                    const record = records[r] as any;
                    if (!record) continue;
                    let rootEl: any = null;
                    if (record.type === "attributes") {
                        const target = record.target as Element;
                        if (!target || target.nodeType !== 1 || !target.isConnected) continue;
                        if (!(target.hasAttribute && target.hasAttribute(PREVIEW_PATH_ATTR))) continue;
                        rootEl = previewRootOf(target);
                    } else {
                        // childList (and the record kinds that do not carry
                        // additions): DOM mutating *inside* an unregistered
                        // root is where a toolless preview lives too (a
                        // loaded-then-ready state, a swapped tab re-keying).
                        let walker = record.target as Element;
                        if (walker && walker.nodeType === 1 && walker.isConnected) {
                            for (let hops = 0; walker && hops < 6; walker = walker.parentElement, hops++) {
                                if (walker.hasAttribute && walker.hasAttribute(PREVIEW_ROOT_ATTR)) {
                                    rootEl = walker;
                                    break;
                                }
                            }
                        }
                        if (rootEl === null) {
                            const addedNodes = record.addedNodes || [];
                            const stop = Math.min(addedNodes.length, 16);
                            for (let n = 0; n < stop && rootEl === null; n++) {
                                const node = addedNodes[n];
                                if (!node || node.nodeType !== 1) continue;
                                if (node.hasAttribute && node.hasAttribute(PREVIEW_ROOT_ATTR)) rootEl = node;
                                else if (node.hasAttribute && node.hasAttribute(PREVIEW_PATH_ATTR)) rootEl = previewRootOf(node);
                                else rootEl = findByAttributeIn(node, PREVIEW_ROOT_ATTR, 64);
                            }
                        }
                    }
                    if (rootEl === null || !rootEl.isConnected || previews.has(rootEl)) continue;
                    if (!enhancePreview(env, rootEl) && typeof console.debug === "function") {
                        console.debug("hover-info: preview header incomplete (no path element)");
                    }
                }
            } catch (error) {
                console.warn("hover-info: preview enhance skipped:", error);
            }
        });
        previewObserver.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: [PREVIEW_PATH_ATTR] });

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

        /** Added-subtree probe budget for the background-job discovery. */
        const DISCOVERY_SCAN_BUDGET = 64;

        // Background-job list discovery (docs/PLAN.md §34). The shell's
        // `JobListAction` renders its menu as a fresh `ul` under the session
        // header only while the trigger is OPEN, so a childList record is the
        // whole discovery path — no attribute probe can see attributes that
        // arrive with the element. A mention probe gates every record so the
        // chat churn stays cheap; the menu is anchored by its localized
        // `aria-label`, resolved from the SHELL's own `job` namespace (never
        // the hash-prefixed row classes).
        const jobsObserver = new win.MutationObserver(function (records) {
            try {
                if (!env.active || !env.jobKillEnabled) return;
                const label = jobMenuLabel(env);
                if (label === null) return;
                for (let r = 0; r < records.length; r++) {
                    const record = records[r] as any;
                    if (!record) continue;
                    const added = record.addedNodes || [];
                    let found: any = null;
                    for (let n = 0; n < added.length && found === null && n < 16; n++) {
                        const node = added[n];
                        if (!node || node.nodeType !== 1) continue;
                        if (isJobMenu(node, label)) found = node;
                        else if (mentionsJobMenu(node, label, DISCOVERY_SCAN_BUDGET)) {
                            const hits: any[] = [];
                            findJobMenusIn(node, hits, DISCOVERY_SCAN_BUDGET, label);
                            found = hits.length > 0 ? hits[0] : null;
                        }
                    }
                    if (found !== null && found.isConnected && !jobMenus.has(found)) {
                        if (!enhanceJobMenu(env, found)) {
                            if (typeof console.debug === "function") console.debug("hover-info: job menu not registered");
                        }
                    }
                }
            } catch (error) {
                console.warn("hover-info: job menu enhance skipped:", error);
            }
        });
        jobsObserver.observe(doc.body, { childList: true, subtree: true });

        // A preview already open at mount time fired no records — one bounded
        // scan catches the reloaded-session case.
        const openPreview = findByAttributeIn(doc.body, PREVIEW_ROOT_ATTR, 40000);
        if (openPreview !== null && env.active) enhancePreview(env, openPreview);
        // Same for the composer: a conversation already open at mount time.
        try {
            syncModelSelectors(env);
        } catch (error) {}
        // And for an open background-job menu (a reloaded tab that kept it
        // open): one bounded body scan registers the first live menu.
        if (env.active && env.jobKillEnabled) {
            const mountLabel = jobMenuLabel(env);
            if (mountLabel !== null) {
                const openMenus: any[] = [];
                findJobMenusIn(doc.body, openMenus, 40000, mountLabel);
                for (let m = 0; m < openMenus.length; m++) {
                    if (openMenus[m].isConnected && !jobMenus.has(openMenus[m])) enhanceJobMenu(env, openMenus[m]);
                }
            }
        }

        return function dispose(): void {
            try {
                bodyObserver.disconnect();
            } catch (error) {}
            try {
                previewObserver.disconnect();
            } catch (error) {}
            try {
                modelObserver.disconnect();
            } catch (error) {}
            try {
                jobsObserver.disconnect();
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
            cards.clear();
            previews.forEach(function (state) {
                if (state.observer) state.observer.disconnect();
                for (let i = 0; i < state.timers.length; i++) win.clearTimeout(state.timers[i]);
            });
            previews.clear();
            cleanupAllJobMenus(env);
            jobMenus.clear();
            statsCache.clear();
            unsubscribeScope();
            disposeCss();
        };
    }, "hover-info: hover-card enhancer");
}

function noop(): void {}
