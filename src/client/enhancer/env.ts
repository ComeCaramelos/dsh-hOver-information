/**
 * Browser half — enhancer shared state.
 *
 * The enhancer is one per-`apply` mount: every DOM node it owns and every
 * observer/timer it holds live in this one context, created by `applyEnhancer`
 * and handed to each component module. Nothing here is module-level — a
 * re-materialized bundle must start from a clean document, and two mounts
 * (never in practice, but tests rely on it) must not share state.
 */

/** Per-card state, keyed by the live card element (in the env's `cards` map). */
export interface CardState {
    /** The live card element (the observer's target). */
    cardEl: any;
    /** The injected copy-bar element (lives inside `.dhi-twrap`'s lead side). */
    bar: any;
    /** The injected header row wrapper (the card's FIRST line), or null. */
    twrap: any;
    /** The injected metrics block, or null when nothing renders. */
    metrics: any;
    /** The signature string of the currently rendered rows. */
    signature: string;
    /** The resolved session id. */
    sessionId: string;
    /** Copy-feedback timers; cleared on cleanup. */
    timers: number[];
    /** The per-card MutationObserver. */
    observer: MutationObserver | null;
    /** Re-entrancy guard for `syncCard`. */
    syncing: boolean;
    /** The click/keydown neutralizer, kept for removal. */
    swallow: ((event: any) => void) | null;
}

/** Per-preview state, keyed by the live preview root (env's `previews`). */
export interface PreviewState {
    /** The live preview root element (the observer's target). */
    rootEl: any;
    /** The current path element (re-resolved on every sync). */
    pathEl: any;
    /** The injected tools bar. */
    bar: any;
    /** Copy-feedback timers. */
    timers: number[];
    /** The per-preview MutationObserver. */
    observer: MutationObserver | null;
    /** Re-entrancy guard for `syncPreview`. */
    syncing: boolean;
}

/** One session's live-stats cache entry (env's `statsCache`). */
export interface StatsEntry {
    /** Timestamp of the last settled fetch attempt. */
    at: number;
    /** The last settled live view (null until one answers). */
    view: any;
    /** A live fetch is in flight. */
    pending: boolean;
    /** The last attempt answered successfully (`at` ages on the full TTL). */
    settled: boolean;
}

/**
 * The per-mount enhancer context. `active`/`refreshMs` mutate from the scope
 * subscription; `startSweep`/`stopSweep`/`refreshAllCards` are wired by the
 * mount (index.ts) before any component runs.
 */
import type { JobMenuState } from "./jobs.js";
export interface EnhancerEnv {
    doc: any;
    win: any;
    /** The plugin `ctx` the enhancer was mounted with. */
    ctx: any;
    /** Per-card state keyed by the live card element. */
    cards: Map<any, CardState>;
    /** Per-preview state keyed by the live preview root element. */
    previews: Map<any, PreviewState>;
    /** Per-menu state keyed by the live background-job `ul` element. */
    jobMenus: Map<any, JobMenuState>;
    /** Per-session stats cache. */
    statsCache: Map<string, StatsEntry>;
    /** Settings-driven row enablement, keyed by METRICS field. */
    metricEnabled: Record<string, boolean>;
    /** Master switch from the scope (default true). */
    active: boolean;
    /** Sidebar-preview-tools switch from the scope (default true). */
    previewToolsEnabled: boolean;
    /** Composer model-selector provider switch from the scope (default true). */
    modelProviderEnabled: boolean;
    /** Background-job kill buttons from the scope (default true). */
    jobKillEnabled: boolean;
    /** Model-selector `title` state we own, keyed by the live DOM node. */
    modelTitles: Map<any, { applied: string | null; original: string | null }>;
    /** Model-selector cell `cellValue` displayed-text state we own, keyed by
     *  the live value element. */
    modelTexts: Map<any, { applied: string | null; original: string | null }>;
    /** Per-seat-anchor model-directory store subscriptions (unsubscribe fns). */
    modelSubs: Map<any, () => void>;
    /** Re-entrancy guard for `syncModelSelectors`. */
    modelSyncing: boolean;
    /** Stats-cache TTL from the scope (default `DEFAULT_REFRESH_MS`). */
    refreshMs: number;
    /** Start the lazy sweep heartbeat (no-op when already running). */
    startSweep: () => void;
    /** Stop the lazy sweep heartbeat. */
    stopSweep: () => void;
    /** Re-sync every open card. */
    refreshAllCards: () => void;
}
