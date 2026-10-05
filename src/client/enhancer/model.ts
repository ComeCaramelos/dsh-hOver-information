/**
 * Browser half — the composer model selector: provider visible in the tooltip.
 *
 * Two stock elements carry the current selection's `title` (docs/PLAN.md §33):
 *
 * - the composer seat's trigger — `button[class$="_trigger"]` inside the
 *   `div[data-slot="conversation.input.model"]` seat anchor — whose stock
 *   `title` is shell-composed `model · effort`;
 * - the root menu's two `button[class$="_cell"][role="menuitem"]` cells
 *   (the Menu / Effort row pair), which carry no `title` at all.
 *
 * The provider is never rendered anywhere while the menu is closed, so it can
 * only be resolved from the component itself: the `ModelSelect` fiber carries
 * the per-session model-directory store, whose `getSnapshot().current` is
 * exactly `{ provider, model, … }` — the same identity the shell composes its
 * visible label from, so what the tooltip adds matches what the control shows.
 * The DOM offers one narrow fallback: while the model-list pane is open, the
 * selected option is `aria-checked="true"` inside a provider-grouped
 * `section[role="group"]` whose group title is the provider's display name.
 *
 * Every write is diff-only and remembers the DOM's stock `title` (or its
 * absence) so the whole surface is restored — never destroyed — when the
 * feature is off or nothing resolves (fail-open). Selection changes are picked
 * up two ways: the shell's own `title`-attribute rewrites reach the DOM
 * observer, and the directory store itself is subscribed per live anchor, so a
 * switch — or a late catalog load that changes only the DOM text — resyncs
 * even when no DOM attribute moves.
 *
 * Detection anchors on the seat's stable `data-slot` attribute; the hashed
 * component classes are consulted only through their component-name suffixes
 * (`class$="_trigger"` / `class$="_cell"` semantics), never a hash prefix.
 */
import { MODEL_CELL_SUFFIX, MODEL_CELL_VALUE_SUFFIX, MODEL_MENUITEM_ROLE, MODEL_OPTION_ROLE, MODEL_SEAT_ATTR, MODEL_SEAT_VALUE, MODEL_TRIGGER_SUFFIX } from "../constants.js";
import { fiberOf } from "./fiber.js";
import type { EnhancerEnv } from "./env.js";

/** The `title` state we own for one live DOM node. */
export interface ModelTitleState {
    /** The `title` last written by us (`null` when never written). */
    applied: string | null;
    /** The DOM's stock `title` at last write (`null` = no `title` attribute). */
    original: string | null;
}

/**
 * The cell's value span: `span[class$="_cellValue"]` inside a root-menu cell.
 * It is where the shell renders the visible Model / Effort label; the provider
 * is never part of it, so we rewrite it (diff-only, restorable) exactly like
 * the `title` surfaces.
 */
export function findCellValueSpan(cellEl: any): any {
    if (!cellEl || cellEl.nodeType !== 1) return null;
    var spans = findAllWhere(cellEl, 200, function (el: any) {
        return classEndsWith(el, MODEL_CELL_VALUE_SUFFIX);
    });
    return spans.length > 0 ? spans[0] : null;
}

/** The live text of a node — its stock value — or null when unreadable. */
function readText(el: any): string | null {
    if (!el || el.nodeType !== 1) return null;
    try {
        var text = (el as any).textContent;
        return typeof text === "string" ? text : null;
    } catch (error) {
        return null;
    }
}

/**
 * Diff-only text write: the DOM's stock value is captured before the first
 * overwrite and recaptured whenever React rewrites it behind our back, so a
 * later restore puts back exactly what the shell rendered. `stock` is the
 * expected shell value (the bare model name); we only rewrite while the live
 * DOM carries that stock value — React may own a value of its own (an Effort
 * label), which must never be touched.
 */
export function writeModelText(env: any, el: any, text: string, stock: string): boolean {
    if (!el || el.nodeType !== 1 || !el.isConnected) return false;
    var dom = readText(el);
    if (dom === null) return false;
    if (dom === text) return true;
    var entry = env.modelTexts.get(el);
    if (!entry) {
        // First touch: only ours if the live value is the stock one.
        if (dom !== stock) return false;
        entry = { applied: null, original: dom };
        env.modelTexts.set(el, entry as ModelTitleState);
    }
    if (entry.applied !== null && dom !== entry.applied) {
        // React rewrote behind our back: recapture stock.
        entry.original = dom;
        entry.applied = null;
    }
    if (entry.applied === null && dom !== stock) {
        // A live value that is neither ours nor the stock — leave it.
        return false;
    }
    try {
        (el as any).textContent = text;
        entry.applied = text;
    } catch (error) {
        return false;
    }
    return true;
}

/** Restore one value span's stock text and forget it. */
export function restoreModelText(env: any, el: any): void {
    var entry = env.modelTexts.get(el);
    if (!entry) return;
    if (el && el.isConnected) {
        var dom = readText(el);
        if (entry.applied !== null && dom === entry.applied) {
            try {
                (el as any).textContent = entry.original === null ? "" : entry.original;
            } catch (error) {}
        }
    }
    env.modelTexts.delete(el);
}

/** Restore every managed value span (feature off, master off, or dispose). */
export function restoreAllModelTexts(env: any): void {
    env.modelTexts.forEach(function (_entry: ModelTitleState, el: any) {
        restoreModelText(env, el);
    });
}


/** Bounded BFS collecting every element under `rootEl` passing `matches`. */
function findAllWhere(rootEl: any, budget: number, matches: (el: any) => boolean): any[] {
    var queue = [rootEl];
    var visited = 0;
    var found: any[] = [];
    while (queue.length > 0) {
        if (visited >= budget) break;
        var node = queue.shift();
        visited += 1;
        var children = node.children || [];
        for (var i = 0; i < children.length; i++) {
            var child = children[i];
            if (!child || child.nodeType !== 1) continue;
            if (matches(child)) found.push(child);
            queue.push(child);
        }
    }
    return found;
}

/** A querySelectorAll that the DOM stub (or an exotic node) may not answer. */
function queryAll(rootEl: any, selector: string, fallbackBudget: number, matches: (el: any) => boolean): any[] {
    var out: any[] = [];
    if (rootEl && typeof rootEl.querySelectorAll === "function") {
        try {
            var found = rootEl.querySelectorAll(selector);
            for (var i = 0; i < found.length; i++) out.push(found[i]);
            return out;
        } catch (error) {
            out = [];
        }
    }
    return findAllWhere(rootEl, fallbackBudget, matches);
}

/** Whether `el` carries a class token ending with `suffix` (never the hash). */
function classEndsWith(el: any, suffix: string): boolean {
    if (!el || el.nodeType !== 1) return false;
    var cls: any = null;
    try {
        cls = typeof el.className === "string" ? el.className : null;
    } catch (error) {
        cls = null;
    }
    if (cls === null && typeof el.getAttribute === "function") {
        var attr = el.getAttribute("class");
        cls = typeof attr === "string" ? attr : null;
    }
    if (typeof cls !== "string") return false;
    var tokens = cls.split(/\s+/);
    for (var i = 0; i < tokens.length; i++) {
        var token = tokens[i];
        if (token.length > suffix.length && token.slice(token.length - suffix.length) === suffix) return true;
    }
    return false;
}

function tagNameIs(el: any, tag: string): boolean {
    return !!el && typeof el.tagName === "string" && el.tagName.toUpperCase() === tag;
}

function attrEquals(el: any, name: string, value: string): boolean {
    return !!el && typeof el.getAttribute === "function" && el.getAttribute(name) === value;
}

/** The composer's named model seat anchor: `div[data-slot="conversation.input.model"]`. */
export function isModelSeatAnchor(el: any): boolean {
    return !!el && attrEquals(el, MODEL_SEAT_ATTR, MODEL_SEAT_VALUE);
}

/** The composer seat's trigger: `button[class$="_trigger"]` (inside a seat). */
export function isModelTrigger(el: any): boolean {
    return tagNameIs(el, "BUTTON") && classEndsWith(el, MODEL_TRIGGER_SUFFIX);
}

/** A root-menu cell: `button[class$="_cell"][role="menuitem"]`. */
export function isModelMenuCell(el: any): boolean {
    return tagNameIs(el, "BUTTON") && attrEquals(el, "role", MODEL_MENUITEM_ROLE) && classEndsWith(el, MODEL_CELL_SUFFIX);
}

/**
 * The cheap gate every DOM record passes before a rescan is worthwhile. It is
 * a hint, never a contract — a stray role/menu button just costs one resync.
 * Checked with O(1) attribute reads; a subtree's worth is found by walking
 * this same predicate.
 */
export function mentionsModelSurface(el: any): boolean {
    if (!el || el.nodeType !== 1) return false;
    if (isModelSeatAnchor(el)) return true;
    if (attrEquals(el, "role", "menu") || attrEquals(el, "role", MODEL_MENUITEM_ROLE) || attrEquals(el, "role", MODEL_OPTION_ROLE)) return true;
    if (classEndsWith(el, MODEL_CELL_VALUE_SUFFIX)) return true;
    return tagNameIs(el, "BUTTON") && (classEndsWith(el, MODEL_TRIGGER_SUFFIX) || classEndsWith(el, MODEL_CELL_SUFFIX));
}

/** Every live seat anchor, ordered as found in the DOM. */
export function findModelSeats(env: any): any[] {
    var doc = env.doc;
    var body = doc && doc.body ? doc.body : null;
    if (!body) return [];
    // Quoted attribute value: `conversation.input.model` is not a bare CSS
    // identifier, so both the real DOM and the stub need the quoted form.
    return queryAll(body, "[" + MODEL_SEAT_ATTR + '="' + MODEL_SEAT_VALUE + '"]', 30000, isModelSeatAnchor);
}

/** Bounded ancestor walk for the nearest ancestor passing `matches`. */
function ancestorWhere(el: any, hopsMax: number, matches: (el: any) => boolean): any {
    var node = el ? el.parentElement : null;
    for (var hops = 0; node && hops < hopsMax; node = node.parentElement, hops++) {
        if (node.nodeType === 1 && matches(node)) return node;
    }
    return null;
}

/** Element text, whitespace-collapsed and trimmed; "" when empty. */
function textOf(el: any): string {
    if (!el) return "";
    var text = "";
    try {
        text = typeof el.textContent === "string" ? el.textContent : "";
    } catch (error) {
        text = "";
    }
    return String(text).replace(/\s+/g, " ").trim();
}

/**
 * The per-session model-directory store carried by the `ModelSelect` fiber —
 * the source of truth for `{provider, model}` (the DOM carries neither while
 * the menu is closed). Bounded upward walk from the element's own fiber.
 */
export function findModelDirectoryStore(startEl: any): any {
    var fiber = fiberOf(startEl);
    var hops = 0;
    while (fiber && hops < 48) {
        var props = fiber.memoizedProps;
        if (props && typeof props === "object") {
            var directory = (props as any).directory;
            if (directory && typeof directory === "object" && typeof directory.getSnapshot === "function") return directory;
        }
        fiber = (fiber as any).return;
        hops += 1;
    }
    return null;
}

/**
 * DOM source: the checked option inside the provider-grouped list, present
 * ONLY while that pane is open. Returns the pair of display names the option
 * is rendered with, or null when nothing is resolvable.
 */
export function domModelSelection(startEl: any): { provider: string; model: string } | null {
    var scope = ancestorWhere(startEl, 12, function (el: any) {
        return attrEquals(el, "role", "menu");
    });
    if (scope === null) scope = startEl;
    if (!scope) return null;
    var options = findAllWhere(scope, 1000, function (el: any) {
        return tagNameIs(el, "BUTTON") && attrEquals(el, "aria-checked", "true");
    });
    if (options.length === 0) return null;
    var optionEl = options[0];
    var model = textOf(optionEl);
    if (model === "") return null;
    var section = ancestorWhere(optionEl, 12, function (el: any) {
        return attrEquals(el, "role", "group");
    });
    if (section === null) return null;
    var titles = findAllWhere(section, 200, function (el: any) {
        return classEndsWith(el, "_groupTitle");
    });
    if (titles.length === 0) return null;
    var provider = textOf(titles[0]);
    if (provider === "") return null;
    return { provider: provider, model: model };
}

/**
 * The DOM source that is independent of the probed element: the composer's own
 * seat is the only node that reliably carries the `directory` fiber (the menu
 * is a `createPortal` off body, so a cell's return-chain does not reach the
 * ModelSelect props). This is the fallback the menu cells resolve through; the
 * seat's DOM source is only meaningful while the model-list pane is open, so
 * the fiber source is what carries it in the common closed-list case.
 */
function composerSelection(env: any): { provider: string; model: string } | null {
    var seats = findModelSeats(env);
    for (var s = 0; s < seats.length; s++) {
        var trigger = findAllWhere(seats[s], 1200, isModelTrigger)[0];
        if (trigger) {
            var found = resolveModelSelection(env, trigger);
            if (found !== null) return found;
        }
        var seatFound = resolveModelSelection(env, seats[s]);
        if (seatFound !== null) return seatFound;
    }
    return null;
}

/**
 * Resolve the current selection as display names: the snapshot's provider
 * group / model names when the catalog resolves them (mirroring the visible
 * label), the raw ids otherwise. Null when no selection is known yet. The
 * composer-wide `fallbackSel` answers only when nothing local resolves.
 */
export function resolveModelSelection(env: any, startEl: any, fallbackSel?: { provider: string; model: string } | null): { provider: string; model: string } | null {
    var store = findModelDirectoryStore(startEl);
    if (store !== null) {
        var snapshot: any = null;
        try {
            snapshot = typeof store.getSnapshot === "function" ? store.getSnapshot() : null;
        } catch (error) {
            snapshot = null;
        }
        var current = snapshot ? (snapshot as any).current : null;
        if (!current || typeof current.provider !== "string" || typeof current.model !== "string") return null;
        var provider = current.provider;
        var model = current.model;
        var groups = snapshot && Array.isArray((snapshot as any).groups) ? (snapshot as any).groups : [];
        for (var g = 0; g < groups.length; g++) {
            var group = groups[g];
            if (!group || group.id !== current.provider) continue;
            if (typeof group.name === "string" && group.name !== "") provider = group.name;
            if (Array.isArray(group.models)) {
                for (var m = 0; m < group.models.length; m++) {
                    var entry = group.models[m];
                    if (entry && entry.id === current.model && typeof entry.name === "string" && entry.name !== "") model = entry.name;
                }
            }
            break;
        }
        return { provider: provider, model: model };
    }
    // The fiber source is unavailable — a checked option in an open model list
    // is the only DOM source there is, then the composer-wide fallback.
    var dom = domModelSelection(startEl);
    if (dom !== null) return dom;
    return fallbackSel === void 0 ? null : fallbackSel;
}

/** The live elements the surface owns: every seat's trigger + live menu cells. */
export function collectModelTargets(env: any): any[] {
    var body = env.doc && env.doc.body ? env.doc.body : null;
    var targets: any[] = [];
    if (!body) return targets;
    var seats = findModelSeats(env);
    for (var s = 0; s < seats.length; s++) {
        var triggers = findAllWhere(seats[s], 1200, isModelTrigger);
        for (var t = 0; t < triggers.length; t++) targets.push(triggers[t]);
    }
    var menus = queryAll(body, '[role="menu"]', 20000, function (el: any) {
        return attrEquals(el, "role", "menu");
    });
    for (var e = 0; e < menus.length; e++) {
        var cells = findAllWhere(menus[e], 3000, isModelMenuCell);
        for (var c = 0; c < cells.length; c++) targets.push(cells[c]);
    }
    return targets;
}

/** Restore one element's stock `title` (or its absence) and forget it. */
export function restoreModelTitle(env: any, el: any, entry: ModelTitleState | undefined): void {
    if (!entry) return;
    if (el && el.isConnected) {
        var dom: any = null;
        try {
            dom = el.getAttribute("title");
        } catch (error) {
            dom = null;
        }
        if (entry.applied !== null && dom === entry.applied) {
            try {
                if (entry.original === null) el.removeAttribute("title");
                else el.setAttribute("title", String(entry.original));
            } catch (error) {}
        }
    }
    env.modelTitles.delete(el);
}

/** Restore every managed element (feature off, master off, or dispose). */
export function restoreAllModelTitles(env: any): void {
    env.modelTitles.forEach(function (entry: ModelTitleState, el: any) {
        try {
            restoreModelTitle(env, el, entry);
        } catch (error) {}
    });
}

/**
 * Diff-only title write: the DOM's stock value is captured before the first
 * overwrite and recaptured whenever React rewrites it behind our back, so a
 * later restore puts back exactly what the shell rendered.
 */
export function writeModelTitle(env: any, el: any, title: string): void {
    var entry = env.modelTitles.get(el);
    if (!entry) {
        entry = { applied: null, original: null };
        env.modelTitles.set(el, entry as ModelTitleState);
    }
    var dom: any = null;
    try {
        dom = el.getAttribute("title");
    } catch (error) {
        dom = null;
    }
    if (entry.applied === null || dom !== entry.applied) entry.original = dom === void 0 ? null : dom;
    if (dom !== title) {
        try {
            el.setAttribute("title", title);
        } catch (error) {}
        entry.applied = title;
    }
}

/** Subscribe every live anchor's directory store; forget the anchors that left. */
function syncModelStoreSubscriptions(env: any, seats: any[]): void {
    for (var s = 0; s < seats.length; s++) {
        var anchor = seats[s];
        if (!anchor || !anchor.isConnected) continue;
        if (env.modelSubs.has(anchor)) continue;
        var store = findModelDirectoryStore(anchor);
        if (store === null || typeof store.subscribe !== "function") continue;
        try {
            var off = store.subscribe(function () {
                try {
                    syncModelSelectors(env);
                } catch (error) {}
            });
            env.modelSubs.set(anchor, typeof off === "function" ? off : function () {});
        } catch (error) {}
    }
    env.modelSubs.forEach(function (unsubscribe: any, anchor: any) {
        if (!anchor || !anchor.isConnected || seats.indexOf(anchor) < 0) {
            try {
                unsubscribe();
            } catch (error) {}
            env.modelSubs.delete(anchor);
        }
    });
}

/** Forget every store subscription (off / master-off / dispose). */
export function clearModelStoreSubscriptions(env: any): void {
    env.modelSubs.forEach(function (unsubscribe: any, anchor: any) {
        try {
            unsubscribe();
        } catch (error) {}
    });
    env.modelSubs.clear();
}

/**
 * One resync of the whole surface: while enabled every live seat trigger /
 * menu cell carries `provider > model`; while off (or master-off) every
 * managed element is restored to its stock `title` and every subscription
 * dropped. Elements that left the DOM or the surface (a closed menu's cells)
 * are restored and forgotten.
 */
export function syncModelSelectors(env: any): void {
    if (!env.active || !env.modelProviderEnabled) {
        clearModelStoreSubscriptions(env);
        restoreAllModelTitles(env);
        restoreAllModelTexts(env);
        return;
    }
    // Re-entry guard: a store subscription can fire while a sync is running
    // (a catalog load resolving mid-rescan) — one pass at a time.
    if (env.modelSyncing === true) return;
    env.modelSyncing = true;
    try {
        var seats = findModelSeats(env);
        syncModelStoreSubscriptions(env, seats);
        // The composer-wide selection every target falls back to: live in the
        // common case (the seat's trigger resolves), invisible from a portal
        // menu cell's own fiber. Computed once per pass.
        var composerSel = composerSelection(env);
        var targets = collectModelTargets(env);
        var live: any[] = [];
        for (var i = 0; i < targets.length; i++) live.push(targets[i]);
        env.modelTitles.forEach(function (entry: ModelTitleState, el: any) {
            if (live.indexOf(el) < 0 || !el.isConnected) {
                try {
                    restoreModelTitle(env, el, entry);
                } catch (error) {}
            }
        });
        env.modelTexts.forEach(function (_entry: ModelTitleState, el: any) {
            // A value span is live while it is still in the DOM inside a live
            // target cell — the per-target write re-seats it; only one that
            // left the document is restored + forgotten here.
            if (!el.isConnected) {
                try {
                    restoreModelText(env, el);
                } catch (error) {}
            }
        });
        for (var t = 0; t < targets.length; t++) {
            var el = targets[t];
            try {
                var sel = resolveModelSelection(env, el, composerSel);
                var title = sel === null || sel.provider === "" || sel.model === ""
                    ? null
                    : sel.provider + " > " + sel.model;
                if (title === null) {
                    var stale = env.modelTitles.get(el);
                    if (stale) restoreModelTitle(env, el, stale);
                } else {
                    writeModelTitle(env, el, title);
                }
                // The visible value span inside a menu cell: overwrite the
                // shell's bare model name with `provider > model`. Only the
                // model row's span carries that stock shape; an Effort row is
                // left alone by the stock guard inside writeModelText.
                if (isModelMenuCell(el)) {
                    var span = findCellValueSpan(el);
                    if (span) {
                        if (title !== null) {
                            if (!writeModelText(env, span, title, sel.model)) {
                                var staleSpan = env.modelTexts.get(span);
                                if (staleSpan) restoreModelText(env, span);
                            }
                        } else {
                            var staleSpan2 = env.modelTexts.get(span);
                            if (staleSpan2) restoreModelText(env, span);
                        }
                    }
                }
            } catch (error) {}
        }
    } finally {
        env.modelSyncing = false;
    }
}

/**
 * Whether a DOM record's target (or any node of a changed subtree) belongs to
 * this surface — the cheap gate before a resync. Never misses the anchor.
 */
export function modelSurfaceMentionsIn(rootEl: any, budget: number): boolean {
    if (!rootEl) return false;
    if (mentionsModelSurface(rootEl)) return true;
    var nodes = findAllWhere(rootEl, budget, mentionsModelSurface);
    return nodes.length > 0;
}
