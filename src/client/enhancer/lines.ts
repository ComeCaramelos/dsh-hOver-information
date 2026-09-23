/**
 * Browser half — stock card line probes.
 *
 * The probes operate on the PRISTINE stack — every injected `dhi-*` row is
 * skipped — so an injected node can never shift a title/time probe (that
 * silent shift is why no glyph was ever cloned under child-index addressing).
 */

/**
 * The stock body lines of a card, in order: the card's stack children minus
 * anything this plugin injected. Every line probe — the DOM fallback's
 * title/time reads and the header-row rebuild — goes through here, so an
 * injected row can never shift a title probe.
 */
export function cardLines(cardEl: any): any[] {
    var stack = cardEl && cardEl.firstElementChild;
    var lines = [];
    if (!stack || !stack.children) return lines;
    for (var i = 0; i < stack.children.length; i++) {
        var child = stack.children[i];
        var cls = child.classList;
        if (cls && (cls.contains("dhi-twrap") || cls.contains("dhi-bar") || cls.contains("dhi-metrics"))) continue;
        lines.push(child);
    }
    return lines;
}

/** The stock title line: the FIRST line of a pristine card. */
export function titleLine(cardEl: any): string {
    var first = cardLines(cardEl)[0];
    if (!first) return "";
    return String(first.textContent || "").trim();
}

/**
 * The stock relative-time line's text — the line that follows the title on a
 * pristine card. Returns "" once the header row folded it in (its text then
 * lives inside `.dhi-lead`, not on its own line).
 */
export function secondLineText(cardEl: any): string {
    var lines = cardLines(cardEl);
    if (lines.length > 1) return String(lines[1].textContent || "").trim();
    return "";
}

export function looksPath(text: string): boolean {
    return !!text && (text.indexOf("/") >= 0 || text.indexOf("\\") >= 0);
}

/** True when the line reads like relative time ("3 min ago", "now", …). */
export function looksRelativeTime(text: string): boolean {
    return /^\d/.test(text) || text.indexOf("min") >= 0 || text.indexOf("sec") >= 0 || text.indexOf("ago") >= 0 || text.indexOf("now") >= 0;
}
