/**
 * Browser half — clipboard + copy buttons.
 *
 * Clipboard first, execCommand textarea fallback, and every failure resolves
 * `false` — a failed copy shows no feedback and leaves the target element
 * untouched (fail-open). The button itself is built by the hover-card and
 * preview components; feedback state (`timers`) belongs to the card.
 */
import { COPY_FEEDBACK_MS } from "../constants.js";
import { ICONS } from "./icons.js";
import { translateSelf } from "./host.js";

/** Copy text through the clipboard API (textarea fallback). */
export function writeClipboard(env: { doc: any; win: any }, text: string): Promise<boolean> {
    if (typeof text !== "string" || text === "") return Promise.resolve(false);
    var clipboard = env.win.navigator && env.win.navigator.clipboard;
    if (clipboard && typeof clipboard.writeText === "function") {
        try {
            return clipboard.writeText(text).then(
                function () {
                    return true;
                },
                function () {
                    return legacyCopy(env, text);
                }
            );
        } catch (error) {
            return Promise.resolve(false);
        }
    }
    return Promise.resolve(legacyCopy(env, text));
}

function legacyCopy(env: { doc: any }, text: string): boolean {
    try {
        var area = env.doc.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.left = "-9999px";
        env.doc.body.appendChild(area);
        area.select();
        var ok = typeof env.doc.execCommand === "function" && env.doc.execCommand("copy");
        area.remove();
        return !!ok;
    } catch (error) {
        return false;
    }
}

/**
 * One injected copy button.
 *
 * `entry` fields:
 *  - `kind`   : the value stamped on the attribute (stable
 *    for tests / re-enumeration);
 *  - `icon`   : key into `ICONS` to restore after feedback
 *    (defaults to `kind`);
 *  - `className`: chrome class (defaults to the hover-card
 *    button class; the preview passes the header-tool one);
 *  - `attr`   : attribute name (defaults to `data-hi-copy`);
 *  - `label`  : `aria-label`/`title` already localized;
 *  - `value`  : a string, OR
 *  - `get`    : `function () → string | Promise<string>`
 *    (the preview resolves its source lazily; the hover card
 *    always passes a ready `value`).
 */
export function makeButton(
    env: { doc: any; win: any; ctx: any },
    entry: { kind: string; icon?: string; className?: string; attr?: string; label?: string; value?: string; get?: () => any },
    state: { timers: number[] }
): any {
    var className = typeof entry.className === "string" ? entry.className : "dhi-btn";
    var attr = typeof entry.attr === "string" ? entry.attr : "data-hi-copy";
    var icon = typeof entry.icon === "string" ? entry.icon : entry.kind;
    var button = env.doc.createElement("button");
    button.type = "button";
    button.className = className;
    button.setAttribute(attr, entry.kind);
    var label = typeof entry.label === "string" ? entry.label : translateSelf(env, entry.kind);
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = ICONS[icon];
    button.addEventListener("click", function (event: any) {
        event.stopPropagation();
        var source = typeof entry.get === "function" ? entry.get() : entry.value;
        var settled = source && typeof source.then === "function" ? source : Promise.resolve(source);
        settled.then(
            function (text: any) {
                writeClipboard(env, typeof text === "string" ? text : "").then(
                    function (ok) {
                        if (!ok) return;
                        button.innerHTML = ICONS.done;
                        var timer = env.win.setTimeout(function () {
                            button.innerHTML = ICONS[icon];
                        }, COPY_FEEDBACK_MS);
                        state.timers.push(timer);
                    },
                    function () {}
                );
            },
            function () {}
        );
    });
    return button;
}
