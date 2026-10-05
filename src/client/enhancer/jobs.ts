/**
 * Browser half — the background-job list: per-row kill buttons.
 *
 * The shell's `JobListAction` (registered by
 * `@deepseek-ai/dsh-client-ui-jobs` in the session header) grows an open
 * `ul` menu whose `li` rows are keyed (React key = the background-job id)
 * with the store's `jobsBySession[sessionId]` views. A menu is anchored by
 * its own localized `aria-label` — resolved through the SHELL's `job`
 * namespace, the very string the component renders — never a hash-prefixed
 * CSS-module class.
 *
 * A live row is one whose STORED status is `running` or `stopping`; a
 * settled row (completed/killed/failed) renders its row without a button,
 * and a button that outlives its job is removed on the next sync. Nothing
 * resolves (no store row, no session identity, a `stopping` row the store
 * already dropped) → nothing is injected and the stock row is left
 * untouched — fail-open.
 *
 * The kill itself is one round trip: the browser calls
 * `hoverInfo/killJob {sessionId, jobId}` and the HOST runs the registry's
 * `kill(id, caller)` with the owning session's live agent. A settled
 * request is confirmed by a check mark (the same 1.3 s idiom as the copy
 * buttons); the row stays live (`stopping`) until it actually settles, and
 * the button drops with the status.
 */
import { JOB_KILL_ATTR, JOB_KILL_ID_ATTR, JOB_LIST_LABEL_KEY, JOB_LIST_LOCALE_NAMESPACE, JOB_LIVE_STATUSES, KILL_FEEDBACK_MS } from "../constants.js";
import { ICONS } from "./icons.js";
import { callHostRpc, sessionsSnapshot, translate } from "./host.js";
import { translateSelf } from "./host.js";
import { fiberOf } from "./fiber.js";

/** Row-count ceilings — a menu that large is not a background-job list. */
const MENU_ROW_LIMIT = 128;
/** Fiber-walk budget for the menu's owning-session fast-path. */
const SESSION_RETURN_LIMIT = 24;
/** Added-subtree probe budget (the model surface probe's idiom). */
const DISCOVERY_BUDGET = 64;

/**
 * One live background-job menu state, keyed by the live `ul` element in
 * `env.jobMenus`. `timers` holds the kill-feedback timers only.
 */
export interface JobMenuState {
    /** The live `ul` element (the per-menu observer's target). */
    ul: any;
    /** The owning session id once resolved; the empty string before that. */
    sessionId: string;
    /** Kill-feedback timers; cleared on cleanup. */
    timers: number[];
    /** The per-menu MutationObserver. */
    observer: MutationObserver | null;
    /** Re-entrancy guard for `syncJobMenu`. */
    syncing: boolean;
}

/** The shell's live-job predicate (the same set the row ordering uses). */
export function isLiveJob(job: any): boolean {
    return !!job && typeof job.status === "string" && JOB_LIVE_STATUSES.indexOf(job.status) >= 0;
}

/**
 * The store's job list in DOM order: live rows first in start order, then
 * settled rows newest-first — the shell's own ordering, used as the
 * fiber-less fallback (the React keys usually carry every row's id).
 */
export function orderedJobs(jobs: any): any[] {
    var out = jobs && jobs.length ? jobs.slice(0, MENU_ROW_LIMIT) : [];
    out.sort(function (left: any, right: any) {
        var liveLeft = isLiveJob(left);
        if (liveLeft !== isLiveJob(right)) return liveLeft ? -1 : 1;
        if (liveLeft) return (left.startedAt || 0) - (right.startedAt || 0);
        var finished = (right.finishedAt || 0) - (left.finishedAt || 0);
        return finished !== 0 ? finished : (left.startedAt || 0) - (right.startedAt || 0);
    });
    return out;
}

/** This environment's expected menu label; null when the shell offers none. */
export function jobMenuLabel(env: { ctx: any }): string | null {
    var value = translate(env, JOB_LIST_LOCALE_NAMESPACE, JOB_LIST_LABEL_KEY);
    // A namespace the shell never registered answers with the key itself —
    // no DOM node carries that string, so a null here costs nothing.
    return value && value !== JOB_LIST_LABEL_KEY ? value : null;
}

/** True for a live `ul` wearing the shell's job-menu label. */
export function isJobMenu(el: any, label: string | null): boolean {
    if (!el || !label || typeof el.tagName !== "string") return false;
    if (el.tagName.toUpperCase() !== "UL") return false;
    var attr = typeof el.getAttribute === "function" ? el.getAttribute("aria-label") : null;
    return attr === label;
}

/**
 * A menu's `li` rows (the shell renders only `li` children; anything else
 * is skipped by `syncJobMenu`, so no pruning here is required).
 */
export function menuRows(ul: any): any[] {
    var rows = [];
    var children = ul && ul.children ? ul.children : [];
    for (var i = 0; i < children.length; i++) {
        var child = children[i];
        if (child && child.nodeType === 1 && typeof child.tagName === "string" && child.tagName.toUpperCase() === "LI") rows.push(child);
        if (rows.length >= MENU_ROW_LIMIT) break;
    }
    return rows;
}

/**
 * The menu's owning session id: the `JobListAction` component's
 * `sessionId` prop, located by walking the `ul`'s fiber return chain (the
 * DOM props answer nothing at the host-fiber hops — the component fiber
 * above them carries it). Returns "" when nothing answers (fail-open).
 */
export function resolveMenuSession(ul: any): string {
    var fiber = fiberOf(ul);
    if (!fiber) return "";
    var hops = 0;
    while (fiber && hops < SESSION_RETURN_LIMIT) {
        var props = fiber.memoizedProps;
        if (props && typeof props === "object" && typeof props.sessionId === "string" && props.sessionId !== "") {
            return props.sessionId;
        }
        fiber = fiber.return;
        hops += 1;
    }
    return "";
}

/**
 * A menu's live store list: `snapshot.jobsBySession[sessionId]`, or null
 * when the store has nothing for that session (the common cold case, and
 * the signal to inject nothing).
 */
export function menuJobs(env: { ctx: any }, sessionId: string): any[] | null {
    if (!sessionId) return null;
    var snapshot = sessionsSnapshot(env);
    var bySession = snapshot && snapshot.jobsBySession ? snapshot.jobsBySession[sessionId] : void 0;
    return Array.isArray(bySession) ? bySession : null;
}

/** The row's job id: its React fiber key (the shell keys rows by job id). */
function rowJobId(row: any): string {
    var fiber = fiberOf(row);
    return fiber && typeof fiber.key === "string" && fiber.key !== "" ? fiber.key : "";
}

/** One live row's kill button; its closure keeps the pending flag. */
function makeKillButton(env: any, state: JobMenuState, row: any, jobId: string, sessionId: string): any {
    var button = env.doc.createElement("button");
    button.type = "button";
    button.className = "dhi-kill";
    button.setAttribute(JOB_KILL_ATTR, "1");
    button.setAttribute(JOB_KILL_ID_ATTR, jobId);
    var label = translateSelf(env, "killJob");
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = ICONS.kill;
    var pending = false;
    button.addEventListener("click", function (event: any) {
        event.stopPropagation();
        if (pending) return;
        pending = true;
        var sid = state.sessionId || sessionId;
        var jid = String(button.getAttribute(JOB_KILL_ID_ATTR) || jobId);
        callHostRpc(env, "hoverInfo/killJob", { sessionId: sid, jobId: jid }).then(
            function (result: any) {
                pending = false;
                if (!result) {
                    if (typeof console.debug === "function") console.debug("hover-info: kill request skipped (no host answer)");
                    return;
                }
                if (result.outcome === "already-finished") {
                    // The registry says the row already settled; the next
                    // sync drops the button with the store status.
                    if (typeof console.debug === "function") console.debug("hover-info: job already settled");
                }
                button.innerHTML = ICONS.done;
                var timer = env.win.setTimeout(function () {
                    if (typeof button.isConnected === "boolean" && !button.isConnected) return;
                    button.innerHTML = ICONS.kill;
                }, KILL_FEEDBACK_MS);
                state.timers.push(timer);
            },
            function () {
                pending = false;
            }
        );
    });
    return button;
}

/** Resync one open menu: diff-only, every DOM write guarded. */
export function syncJobMenu(env: any, state: JobMenuState): void {
    if (state.syncing) return;
    state.syncing = true;
    try {
        var ul = state.ul;
        if (!ul || !ul.isConnected) return;
        var rows = menuRows(ul);
        if (rows.length === 0) return;

        // Master off (or the kill switch off): every owned button comes
        // out; nothing is resolved.
        if (!env.active || !env.jobKillEnabled) {
            for (var off = 0; off < rows.length; off++) {
                var stale = rows[off].querySelector ? rows[off].querySelector("[" + JOB_KILL_ATTR + "]") : null;
                if (stale && stale.parentElement === rows[off]) rows[off].removeChild(stale);
            }
            return;
        }

        if (state.sessionId === "") {
            var resolved = resolveMenuSession(ul);
            if (resolved === "") return; // unanchored: leave every row stock
            state.sessionId = resolved;
        }
        var list = menuJobs(env, state.sessionId);
        if (list === null) return; // no store rows for this session: fail-open

        var ordered = orderedJobs(list);
        var byId: Record<string, any> = {};
        for (var o = 0; o < ordered.length; o++) if (ordered[o] && typeof ordered[o].id === "string") byId[ordered[o].id] = ordered[o];

        var position = 0;
        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            var jobId = rowJobId(row);
            var job;
            if (jobId !== "") job = byId[jobId];
            else if (ordered[position]) {
                // Fiber-less row: position matches the shell's own ordering.
                jobId = String(ordered[position].id);
                job = ordered[position];
            }
            position += 1;
            var live = job ? isLiveJob(job) : false;
            var existing = row.querySelector ? row.querySelector("[" + JOB_KILL_ATTR + "]") : null;
            var owned = existing && existing.parentElement === row ? existing : null;
            if (live) {
                if (!owned) row.appendChild(makeKillButton(env, state, row, jobId, state.sessionId));
                else if (owned.getAttribute && owned.getAttribute(JOB_KILL_ID_ATTR) !== jobId) {
                    row.removeChild(owned);
                    row.appendChild(makeKillButton(env, state, row, jobId, state.sessionId));
                }
            } else if (owned) {
                row.removeChild(owned);
            }
        }
    } finally {
        state.syncing = false;
    }
}

/**
 * Register one live menu element. Discovery-only: the first sync runs here,
 * the per-menu observer keeps it settled and the lazy sweep backstops a
 * missed churn.
 */
export function enhanceJobMenu(env: any, ulEl: any): boolean {
    if (env.jobMenus.has(ulEl)) return true;
    if (!isJobMenu(ulEl, jobMenuLabel(env))) return false;
    var state: JobMenuState = { ul: ulEl, sessionId: "", timers: [], observer: null, syncing: false };
    env.jobMenus.set(ulEl, state);
    try {
        var observer = new env.win.MutationObserver(function () {
            try {
                if (!ulEl.isConnected) cleanupJobMenu(env, ulEl, state);
                else if (env.active) syncJobMenu(env, state);
            } catch (error) {}
        });
        observer.observe(ulEl, { childList: true, subtree: true });
        state.observer = observer;
    } catch (error) {}
    syncJobMenu(env, state);
    env.startSweep();
    return true;
}

/** Drop one menu's observer + timers and forget it. */
export function cleanupJobMenu(env: any, ulEl: any, state?: JobMenuState): void {
    var live = state || env.jobMenus.get(ulEl);
    if (!live) return;
    if (live.observer) {
        try {
            live.observer.disconnect();
        } catch (error) {}
    }
    for (var i = 0; i < live.timers.length; i++) env.win.clearTimeout(live.timers[i]);
    live.timers.length = 0;
    env.jobMenus.delete(ulEl);
    if (env.jobMenus.size === 0 && env.cards.size === 0 && env.previews.size === 0) env.stopSweep();
}

/** Detach every menu's buttons + state (dispose / master off). */
export function cleanupAllJobMenus(env: any): void {
    env.jobMenus.forEach(function (state: JobMenuState, ulEl: any) {
        cleanupJobMenu(env, ulEl, state);
    });
}

/**
 * Bounded scan for mounted menus inside `rootEl` (the model-surface probe's
 * shape: count each visited element against the budget).
 */
export function findJobMenusIn(rootEl: any, out: any[], budget: number, label: string | null): void {
    var visited = 0;
    function walk(node: any): void {
        if (!node || visited >= budget) return;
        var children = node.children ? node.children : [];
        for (var i = 0; i < children.length; i++) {
            if (visited >= budget) return;
            var child = children[i];
            visited += 1;
            if (isJobMenu(child, label)) out.push(child);
            walk(child);
        }
    }
    walk(rootEl);
}

/**
 * The discovery record probe: does this added subtree (or any node it
 * reaches inside the probe budget) contain a `ul` that could be a job
 * menu? Label-checked first — a string compare per element is the cheap
 * gate before the row probes ever run.
 */
export function mentionsJobMenu(node: any, label: string, budget: number): boolean {
    var visited = 0;
    function walk(n: any): boolean {
        if (!n || visited >= budget) return false;
        visited += 1;
        if (isJobMenu(n, label)) return true;
        var children = n.children ? n.children : [];
        for (var i = 0; i < children.length; i++) if (walk(children[i])) return true;
        return false;
    }
    return walk(node);
}
