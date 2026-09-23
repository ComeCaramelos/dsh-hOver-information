/**
 * Browser half — document-preview header tools.
 *
 * Two tools on the stock file preview's header: **copy file content** and
 * **copy file path**. Detection uses ONLY the shell's stable data attributes
 * — the preview root's `data-document-preview` and the header path element's
 * `data-textpreview-path` (whose `title` is the absolute display path) — never
 * the hashed `*Header`/`*tool` CSS-module class names (AGENTS rule).
 *
 * Content source, in order:
 *  1. the renderer's `content` prop through the fiber fast-path (same
 *     technique as the hover-card session id): `{ kind: "text", text, eof }`
 *     is the SOURCE the DOM lines are built from, so the copy is exact
 *     regardless of the active viewer (the Markdown viewer's DOM is rendered
 *     HTML, not source);
 *  2. for `eof: false` (a file wider than one page) the host
 *     `workspaceFiles/readAll` answers the whole file; the scope id picks a
 *     workspace-root `cwd` only, never confines the absolute `path` requested
 *     (docs/PLAN.md §19). No live session → fall back;
 *  3. else copy the loaded (partial) source;
 *  4. else (no text source at all — e.g. the byte renderers) the click copies
 *     nothing: fail-open, one debug line.
 *
 * The whole surface is gated per live setting by `showPreviewTools` (rendered
 * as its own catalog block in the Settings card): `syncPreview` detaches the
 * bar while off and re-seats it when re-enabled, so the toggle applies live to
 * already-open previews without a reload.
 */
import { PREVIEW_PATH_ATTR, PREVIEW_ROOT_ATTR } from "../constants.js";
import { findPreviewContent } from "./fiber.js";
import { sessionsSnapshot, callHostRpc } from "./host.js";
import { makeButton } from "./copy.js";
import { translateSelf } from "./host.js";

/** Bounded BFS for the first element under `rootEl` carrying `attr`. */
export function findByAttributeIn(rootEl: any, attr: string, budget: number): any {
    var queue = [rootEl];
    var visited = 0;
    while (queue.length > 0) {
        if (visited >= budget) return null;
        var node = queue.shift();
        visited += 1;
        var children = node.children || [];
        for (var i = 0; i < children.length; i++) {
            var child = children[i];
            if (child.nodeType !== 1) continue;
            if (child.hasAttribute && child.hasAttribute(attr)) return child;
            queue.push(child);
        }
    }
    return null;
}

/** The preview root is a tagged ancestor of the path element. */
export function previewRootOf(pathEl: any): any {
    var node = pathEl.parentElement;
    for (var hops = 0; node && hops < 6; hops++) {
        if (node.hasAttribute && node.hasAttribute(PREVIEW_ROOT_ATTR)) return node;
        node = node.parentElement;
    }
    return null;
}

/** The absolute path shown in the header (`title` = displayPath). */
export function previewAbsolutePath(env: any, state: any): string {
    var pathEl = state.pathEl && state.pathEl.isConnected ? state.pathEl : findByAttributeIn(state.rootEl, PREVIEW_PATH_ATTR, 3000);
    if (!pathEl || typeof pathEl.getAttribute !== "function") return "";
    var title = pathEl.getAttribute("title");
    return typeof title === "string" ? title : "";
}

/** First live session id — the wire identity for the file-scope lookup. */
export function pickScopeSessionId(env: any): string {
    var snap = sessionsSnapshot(env);
    var byId = snap && snap.byId ? snap.byId : null;
    if (!byId) return "";
    for (var id in byId) {
        if (!Object.prototype.hasOwnProperty.call(byId, id)) continue;
        return String(id);
    }
    return "";
}

/** Base64 → UTF-8 text; `null` when undecodable (fail-open). */
export function decodeBase64Text(env: any, value: any): string | null {
    if (typeof value !== "string" || value === "") return null;
    var win = env.win;
    try {
        var raw = typeof win.atob === "function" ? win.atob(value) : null;
        if (typeof raw !== "string") return null;
        if (typeof win.TextDecoder === "function") {
            var bytes = new Uint8Array(raw.length);
            for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
            return new win.TextDecoder("utf-8").decode(bytes);
        }
        return decodeURIComponent(escape(raw));
    } catch (error) {
        return null;
    }
}

/**
 * The whole file from the host — for previews whose loaded pages do not
 * reach eof. `workspaceFiles/readAll` answers `data` base64 over the same
 * `/api` envelope the stats call uses; the scope id picks the workspace root
 * only, never confines an absolute `path`.
 * @returns promise of the text, or null on any failure.
 */
export function fetchPreviewFileText(env: any, state: any): Promise<string | null> {
    var scopeId = pickScopeSessionId(env);
    var path = previewAbsolutePath(env, state);
    if (scopeId === "" || path === "") return Promise.resolve(null);
    return callHostRpc(env, "workspaceFiles/readAll", { workspaceFileScopeId: scopeId, path: path }).then(
        function (value: any) {
            if (!value || typeof value !== "object") return null;
            return decodeBase64Text(env, value.data);
        },
        function () {
            return null;
        }
    );
}

/**
 * Resolve the source a content-copy click will hand to the clipboard;
 * `""` means nothing to copy (no feedback).
 */
export function resolvePreviewText(env: any, state: any): Promise<string> {
    var hit = findPreviewContent(state.rootEl);
    if (!hit) {
        if (typeof console !== "undefined" && typeof console.debug === "function") {
            console.debug("hover-info: preview has no text source (byte renderer or unloaded)");
        }
        return Promise.resolve("");
    }
    if (hit.eof) return Promise.resolve(hit.text);
    return fetchPreviewFileText(env, state).then(function (full) {
        // No host answer: still copy what loaded rather than silently do
        // nothing on an already-shown file.
        return typeof full === "string" ? full : hit.text;
    });
}

/** Inject/refresh one preview's header tools. Idempotent. */
export function enhancePreview(env: any, rootEl: any): boolean {
    if (env.previews.has(rootEl)) return true;
    var pathEl = findByAttributeIn(rootEl, PREVIEW_PATH_ATTR, 3000);
    if (!pathEl) return false;
    var doc = env.doc;
    var bar = doc.createElement("div");
    bar.className = "dhi-tools";
    bar.setAttribute("data-hi-tools", "1");
    var state: any = { rootEl: rootEl, pathEl: pathEl, bar: bar, timers: [], observer: null, syncing: false };
    bar.appendChild(
        makeButton(
            env,
            {
                kind: "content",
                icon: "copy",
                className: "dhi-tool",
                attr: "data-hi-preview-tool",
                label: translateSelf(env, "copyFileContent"),
                get: function () {
                    return resolvePreviewText(env, state);
                }
            },
            state
        )
    );
    bar.appendChild(
        makeButton(
            env,
            {
                kind: "path",
                icon: "path",
                className: "dhi-tool",
                attr: "data-hi-preview-tool",
                label: translateSelf(env, "copyFilePath"),
                get: function () {
                    return previewAbsolutePath(env, state);
                }
            },
            state
        )
    );
    var observer = new env.win.MutationObserver(function () {
        try {
            if (!rootEl.isConnected) return;
            syncPreview(env, state);
        } catch (error) {}
    });
    observer.observe(rootEl, { childList: true, subtree: true });
    state.observer = observer;
    env.previews.set(rootEl, state);
    env.startSweep();
    syncPreview(env, state);
    return true;
}

/**
 * Diff-only resync: while the sidebar preview tools are ENABLED the tools bar
 * re-seats at the end of the current header (React's own re-renders can append
 * tool buttons after ours), and the path element re-resolves — a swapped file
 * tab keeps one root with a different path element/title. A settled sync
 * touches nothing. While they are DISABLED the bar is detached (the state and
 * its bar survive, so re-enabling re-seats it) — nothing is removed, only
 * unstored.
 */
export function syncPreview(env: any, state: any): void {
    if (state.syncing) return;
    state.syncing = true;
    try {
        var rootEl = state.rootEl;
        if (!rootEl.isConnected) return;
        if (!env.previewToolsEnabled) {
            if (state.bar.parentElement) state.bar.remove();
            return;
        }
        var pathEl = state.pathEl && state.pathEl.isConnected ? state.pathEl : findByAttributeIn(rootEl, PREVIEW_PATH_ATTR, 3000);
        if (!pathEl) return;
        state.pathEl = pathEl;
        var header = pathEl.parentElement;
        if (!header) return;
        var children = header.children || [];
        if (state.bar.parentElement !== header || children[children.length - 1] !== state.bar) header.appendChild(state.bar);
    } finally {
        state.syncing = false;
    }
}

/** Drop one preview's observers/timers. */
export function cleanupPreview(env: any, rootEl: any): void {
    var state = env.previews.get(rootEl);
    if (!state) return;
    if (state.observer) state.observer.disconnect();
    for (var i = 0; i < state.timers.length; i++) env.win.clearTimeout(state.timers[i]);
    state.timers.length = 0;
    env.previews.delete(rootEl);
    if (env.cards.size === 0 && env.previews.size === 0) env.stopSweep();
}
