/**
 * Browser half — one hover-card enhancement.
 *
 * The layout is restructured into ONE header row (`.dhi-twrap`), the card's
 * FIRST line, ABOVE the title: on the left a `.dhi-lead` holds the cloned
 * status glyph + the relative-time text, on the right a `.dhi-bar` holds the
 * two copy buttons. The glyph is cloned from the first `[data-state]` node on
 * the lines that FOLLOW the title/time lines; every stock status line is then
 * removed and its label folded into the clone's `title`/`aria-label` (one icon
 * reads once). The whole-card stock copy (card `role="button"` + click →
 * copyText) is neutralized only on this card, via per-card listeners the
 * card's observer survives.
 *
 * Every DOM write in `syncCard` is guarded ("only when actually different"):
 * an unguarded rebuild appends into the very subtree the card's own observer
 * watches, so every sync re-arms it — once metrics render, the callbacks spin
 * a DOM-churn microtask loop that freezes the tab. A settled sync therefore
 * touches nothing; the re-injection the observer is *for* (React's "Copied"
 * re-render sweeping the injected nodes) is a real change and still re-syncs.
 */
import { identify } from "./identify.js";
import { cardLines, looksRelativeTime } from "./lines.js";
import { makeButton } from "./copy.js";
import { buildMetricsBlock, metricRows, metricsSignature } from "./metrics-block.js";
import { statsFor } from "./stats.js";
import { translateSelf } from "./host.js";

/** Resync one open card. Idempotent and diff-guarded. */
export function syncCard(env: any, state: any): void {
    if (state.syncing) return;
    state.syncing = true;
    try {
        var cardEl = state.cardEl;
        if (!cardEl.isConnected) return;

        // Re-build the time+bar wrapper when it was removed — an injection the
        // shell swept away (React's "Copied" re-render) is what re-seats it.
        if (!state.twrap) {
            rebuildTimeWrap(env, state, cardEl);
        } else if (!cardEl.contains(state.twrap)) {
            // twrap detached → nuke stale leftovers and reconstruct.
            var stack = cardEl.firstElementChild;
            if (stack) {
                var bar = state.bar;
                for (var j = stack.children.length - 1; j >= 0; j--) {
                    var ch = stack.children[j];
                    if (ch.classList && ch.classList.contains("dhi-bar") && ch !== bar) stack.removeChild(ch);
                }
            }
            rebuildTimeWrap(env, state, cardEl);
        }

        // Old-style standalone bar (direct child of stack): remove.
        {
            var stack2 = cardEl.firstElementChild;
            if (stack2) {
                var bar2 = state.bar;
                for (var s = stack2.children.length - 1; s >= 0; s--) {
                    var ch2 = stack2.children[s];
                    if (ch2.classList && ch2.classList.contains("dhi-bar") && ch2 !== bar2) stack2.removeChild(ch2);
                }
            }
        }

        if (cardEl.getAttribute("role") === "button") cardEl.removeAttribute("role");
        if (cardEl.hasAttribute("tabindex")) cardEl.removeAttribute("tabindex");
        if (cardEl.style.cursor !== "default") cardEl.style.cursor = "default";

        var view = statsFor(env, state.sessionId);
        var rows = metricRows(env, view);
        var want = rows.length > 0;
        var contained = state.metrics !== null && cardEl.contains(state.metrics);
        if (contained !== want || (want && state.signature !== metricsSignature(rows))) {
            if (state.metrics !== null && state.metrics.parentElement) state.metrics.parentElement.removeChild(state.metrics);
            state.metrics = null;
            state.signature = "";
            if (want) {
                var reStack = cardEl.firstElementChild;
                if (reStack) {
                    var block = buildMetricsBlock(env, rows);
                    reStack.appendChild(block);
                    state.metrics = block;
                    state.signature = metricsSignature(rows);
                }
            }
        }
    } finally {
        state.syncing = false;
    }
}

/**
 * Build (or re-build) the header row: `.dhi-twrap` with the cloned status
 * glyph + relative time (left) and the copy buttons (right). Locating is
 * structural and on the pristine stack (see cardLines), so an injected node
 * never shifts a probe (AGENTS rule).
 */
export function rebuildTimeWrap(env: any, state: any, cardEl: any): void {
    var doc = env.doc;
    var stack = cardEl.firstElementChild;
    if (!stack) return;
    var bar = state.bar;

    // Stock lines only: skip injected/stale nodes.
    var lines = cardLines(cardEl);

    // Relative-time line ("3 min ago", "now", …).
    var timeEl = null;
    var timeAt = -1;
    for (var ti = 0; ti < lines.length; ti++) {
        var text = (lines[ti].textContent || "").trim();
        if (looksRelativeTime(text)) {
            timeEl = lines[ti];
            timeAt = ti;
            break;
        }
    }

    // Status lines follow the title (and, when present, the time line), and
    // each owns its `StateDot` glyph. Collect them all: the first glyph feeds
    // the row's icon, every label becomes that icon's `title`, and the lines
    // themselves go away.
    var statusStart = timeAt >= 0 ? timeAt + 1 : 1;
    var glyph = null;
    var statusLines: any[] = [];
    var statusLabels: string[] = [];
    for (var si = statusStart; si < lines.length; si++) {
        if (!lines[si].querySelector) continue;
        var own = lines[si].querySelector("[data-state]") || lines[si].querySelector("svg");
        if (!own) continue;
        if (glyph === null) glyph = own;
        var label = (lines[si].textContent || "").trim();
        if (label) statusLabels.push(label);
        statusLines.push(lines[si]);
    }
    var statusTitle = statusLabels.join(" · ");

    // Remember what the fold removes: `stripCard` re-seats exactly these lines
    // at their original stack positions, so handing the card back returns it
    // to the shell rather than leaving a half-restructured DOM.
    state.stripped = false;
    // `lines` is the pristine stack in order, so its own indices are the
    // positions `stripCard` re-seats these lines back into.
    var stockLines: any[] = [];
    if (timeEl) stockLines.push({ node: timeEl, index: timeAt });
    for (var li = statusStart; li < lines.length; li++) {
        if (!lines[li].querySelector) continue;
        if (!(lines[li].querySelector("[data-state]") || lines[li].querySelector("svg"))) continue;
        stockLines.push({ node: lines[li], index: li });
    }
    state.stockLines = stockLines;

    // The title line is the first stock line — unless the relative-time probe
    // landed on index 0, which means this card has no title line and lines[0]
    // is the line about to be replaced.
    var titleEl = timeAt === 0 ? null : lines[0] || null;
    if (titleEl) titleEl.dataset.hiTitle = "1";
    state.titleEl = titleEl;

    var twrap = doc.createElement("div");
    twrap.className = "dhi-twrap";
    twrap.dataset.hiTwrap = "1";
    var lead = doc.createElement("span");
    lead.className = "dhi-lead";
    lead.dataset.hiLead = "1";
    twrap.appendChild(lead);

    if (glyph) {
        var clone = glyph.cloneNode(true);
        // The stock dot already carries its own inline size — a cssText
        // override would wipe it — and it keeps its `data-state` so the color
        // rules still apply to the clone. Only un-float it.
        clone.style.flex = "none";
        clone.dataset.hiStatusIcon = "1";
        if (statusTitle) {
            // The status text survives here, as the icon's title.
            clone.setAttribute("title", statusTitle);
            clone.setAttribute("aria-label", statusTitle);
            clone.removeAttribute("aria-hidden");
        }
        lead.appendChild(clone);
    }
    twrap.appendChild(bar);
    if (timeEl) {
        var timeSpan = doc.createElement("span");
        timeSpan.textContent = timeEl.textContent;
        timeSpan.style.whiteSpace = "nowrap";
        lead.appendChild(timeSpan);
    }

    // The row sits at the TOP of the stack — right above the title line. A
    // card with no title line falls back to where the time line was, so it
    // never ends up below the remaining lines.
    var anchor = titleEl || timeEl || statusLines[0] || (lines.length > 1 ? lines[1] : null);
    if (anchor) stack.insertBefore(twrap, anchor);
    else stack.appendChild(twrap);
    if (timeEl) timeEl.remove();
    for (var ri = 0; ri < statusLines.length; ri++) {
        if (statusLines[ri].parentElement) statusLines[ri].remove();
    }
    state.twrap = twrap;
}

/**
 * Enhance one hover card: resolve identity, stamp the marker, grow the
 * copy buttons + header row. Returns false (nothing injected) when identity
 * cannot be resolved cleanly.
 */
export function enhanceCard(env: any, cardEl: any): boolean {
    var info = identify(env, cardEl);
    if (!info || info.id === void 0) return false;
    // Marker for tests + re-enumeration by future body observers.
    cardEl.setAttribute("data-hi-session", String(info.id));

    var doc = env.doc;
    var bar = doc.createElement("div");
    bar.className = "dhi-bar";
    bar.setAttribute("data-hi", "1");
    var state: any = {
        cardEl: cardEl, bar: bar, twrap: null, metrics: null, signature: "", sessionId: info.id,
        timers: [], observer: null, syncing: false, swallow: null,
        // What `stripCard` hands back when this mount ends — the off half the
        // Plugins page answers by disabling the bundle row (docs/PLAN.md §40).
        stockLines: [], stockRole: cardEl.getAttribute("role"),
        stockTabindex: cardEl.hasAttribute("tabindex") ? cardEl.getAttribute("tabindex") : null,
        stockCursor: cardEl.style.cursor, stripped: false, attached: false
    };

    var entries = [
        { kind: "id", value: String(info.id), label: translateSelf(env, "copySessionId") },
        ...(info.cwd ? [{ kind: "path", value: String(info.cwd), label: translateSelf(env, "copyWorkspacePath") }] : [])
    ];
    for (var i = 0; i < entries.length; i++) bar.appendChild(makeButton(env, entries[i], state));

    // Build the restructured layout: time+bar inline, status on title.
    rebuildTimeWrap(env, state, cardEl);

    // Neutralize the stock whole-card copy: the card is the whole copy
    // surface (`role="button"` + click → copyText), which the corner icons
    // now replace. Attached per card, and dropped again by `stripCard`.
    if (!state.swallow) {
        state.swallow = function (event: any) {
            event.stopPropagation();
        };
    }
    attachSwallow(cardEl, state);

    // Re-apply: React's "Copied" re-render sweeps the injected nodes; the
    // observer re-syncs while the card stays open.
    var observer = new env.win.MutationObserver(function () {
        try {
            if (!cardEl.isConnected) return;
            syncCard(env, state);
        } catch (error) {}
    });
    observer.observe(cardEl, { childList: true, subtree: true });
    state.observer = observer;
    env.cards.set(cardEl, state);
    env.startSweep();
    syncCard(env, state);
    return true;
}

/** Drop one card's observers/timers. Removal of DOM follows the element. */
export function cleanupCard(env: any, cardEl: any): void {
    var state = env.cards.get(cardEl);
    if (!state) return;
    if (state.observer) state.observer.disconnect();
    for (var i = 0; i < state.timers.length; i++) env.win.clearTimeout(state.timers[i]);
    state.timers.length = 0;
    env.cards.delete(cardEl);
    if (env.cards.size === 0) env.stopSweep();
}

/**
 * Return one already-open card to its stock shape — what the plugin's end does
 * (the enhancer is unmounted when the bundle row is disabled; PLAN §40). The
 * injected nodes go, the stock lines `rebuildTimeWrap` folded in go back at
 * their original stack positions, the title marker goes, and the whole-card
 * copy surface is handed back to the shell.
 *
 * Diff-only: a card that is already stock (never enhanced, or already
 * stripped) is a no-op, so the hand-back costs nothing. A card whose DOM React
 * rebuilt in the meantime is answered by the rebuild paths — re-inserting a
 * line the shell already re-rendered would duplicate it.
 */
export function stripCard(env: any, state: any): void {
    if (!state || state.stripped) return;
    var cardEl = state.cardEl;
    if (cardEl && cardEl.isConnected) {
        var stack = cardEl.firstElementChild;
        if (stack) {
            // Every injected stack child goes first, so the stock positions
            // below read the pristine child list.
            for (var i = stack.children.length - 1; i >= 0; i--) {
                var injected = stack.children[i];
                if (injected.classList && (injected.classList.contains("dhi-twrap") || injected.classList.contains("dhi-bar") || injected.classList.contains("dhi-metrics"))) {
                    stack.removeChild(injected);
                }
            }
            var stockLines = state.stockLines || [];
            if (stockLines.length > 0) {
                // Lines the shell already renders (React rebuilt them behind
                // us) are never re-seated — that would duplicate them.
                var present: string[] = [];
                for (var p = 0; p < stack.children.length; p++) {
                    var presentText = (stack.children[p].textContent || "").trim();
                    if (presentText) present.push(presentText);
                }
                for (var j = 0; j < stockLines.length; j++) {
                    var entry = stockLines[j];
                    if (!entry || !entry.node) continue;
                    if (entry.node.isConnected && stack.contains(entry.node)) continue;
                    var ownText = (entry.node.textContent || "").trim();
                    if (ownText && present.indexOf(ownText) >= 0) continue;
                    var ref = stack.children[Math.min(entry.index, stack.children.length)] || null;
                    try {
                        stack.insertBefore(entry.node, ref);
                    } catch (error) {}
                }
            }
        }
        state.metrics = null;
        state.twrap = null;
        state.signature = "";
        if (state.titleEl) {
            try {
                if (state.titleEl.hasAttribute && state.titleEl.hasAttribute("data-hi-title")) state.titleEl.removeAttribute("data-hi-title");
            } catch (error) {}
        }
        cardEl.removeAttribute("data-hi-session");
        // The card is again the shell's own copy surface.
        if (state.stockRole !== null && !cardEl.getAttribute("role")) cardEl.setAttribute("role", state.stockRole);
        if (state.stockTabindex !== null && !cardEl.hasAttribute("tabindex")) cardEl.setAttribute("tabindex", state.stockTabindex);
        cardEl.style.cursor = state.stockCursor || "";
    }
    state.stripped = true;
    state.stockLines = [];
    state.titleEl = null;
    detachSwallow(cardEl, state);
}

/** The per-card copy neutralizer, attached exactly once. */
function attachSwallow(cardEl: any, state: any): void {
    if (state.attached) return;
    cardEl.addEventListener("click", state.swallow, false);
    cardEl.addEventListener("keydown", state.swallow, false);
    state.attached = true;
}

/** Hand the whole-card copy path back to the shell. */
function detachSwallow(cardEl: any, state: any): void {
    if (!state.attached) return;
    state.attached = false;
    try {
        cardEl.removeEventListener("click", state.swallow, false);
        cardEl.removeEventListener("keydown", state.swallow, false);
    } catch (error) {}
}
