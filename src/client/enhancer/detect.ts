/**
 * Browser half — structural hover-card detection (docs/PLAN.md §6.2).
 *
 * A `position: fixed` 244 px portal child of `body` with numeric left/top and
 * a ≥2-child column stack. Matches structure only — hashed CSS-module class
 * names change per build.
 */
import { HOVER_CARD_WIDTH } from "../constants.js";

export function isHoverCard(doc: any, win: any, el: any): boolean {
    try {
        if (!el || el.nodeType !== 1 || el.tagName !== "DIV") return false;
        if (el.parentElement !== doc.body) return false;
        var cs = win.getComputedStyle(el);
        if (cs.position !== "fixed") return false;
        var width = parseFloat(cs.width);
        if (!(Math.abs(width - HOVER_CARD_WIDTH) < 0.5)) return false;
        if (typeof el.style.left !== "string" || el.style.left === "" || !/px\s*$/.test(el.style.left)) return false;
        if (typeof el.style.top !== "string" || el.style.top === "" || !/px\s*$/.test(el.style.top)) return false;
        var stack = el.firstElementChild;
        if (!stack || stack.tagName !== "DIV") return false;
        var stackCs = win.getComputedStyle(stack);
        return stackCs.display === "flex" && stackCs.flexDirection === "column" && stack.children.length >= 2;
    } catch (error) {
        return false;
    }
}
