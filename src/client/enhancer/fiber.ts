/**
 * Browser half — React fiber probes.
 *
 * React stores the fiber under a non-enumerable `__reactFiber$…` own property,
 * so `Object.getOwnPropertyNames` is required (`Object.keys` would miss it).
 * Every walk is bounded — an unbounded walk down a large subtree is a
 * jank source the shell would blame.
 */

/** The fiber node for a DOM element, or undefined. */
export function fiberOf(el: any): any {
    try {
        // React stores the fiber under a non-enumerable `__reactFiber$…`
        // own property, so getOwnPropertyNames is required (Object.keys
        // would miss it).
        var keys = typeof Object.getOwnPropertyNames === "function" ? Object.getOwnPropertyNames(el) : Object.keys(el);
        for (var i = 0; i < keys.length; i++) {
            if (keys[i].indexOf("__reactFiber$") === 0) return el[keys[i]];
        }
    } catch (error) {}
    return void 0;
}

/**
 * Walk the React fiber subtree of the portaled card for the
 * SessionHoverContent `node` prop.
 * @returns the session id, or undefined.
 */
export function findFiberSessionId(cardEl: any): string | undefined {
    var root = fiberOf(cardEl);
    if (!root) return void 0;
    var queue = [root];
    var visited = 0;
    while (queue.length > 0 && visited < 80) {
        var fiber = queue.shift();
        visited += 1;
        var props = fiber.memoizedProps;
        if (props && typeof props === "object" && props.node && typeof props.node === "object" && props.node.id !== void 0) {
            return String(props.node.id);
        }
        if (fiber.child) queue.push(fiber.child);
        if (fiber.sibling) queue.push(fiber.sibling);
    }
    return void 0;
}

/**
 * Fiber fast-path: the body renderer's `content` prop — the source the lines
 * are built from. Bounded like the card's session-id walk (docs/PLAN.md
 * §6.2).
 * @returns `{ text, eof }`, or null for no text view.
 */
export function findPreviewContent(rootEl: any): { text: string; eof: boolean } | null {
    var fiber = fiberOf(rootEl);
    if (!fiber) return null;
    var queue = [fiber];
    var visited = 0;
    while (queue.length > 0 && visited < 400) {
        var node = queue.shift();
        visited += 1;
        var props = node.memoizedProps;
        if (props && typeof props === "object") {
            var content = props.content;
            if (content && typeof content === "object" && content.kind === "text" && typeof content.text === "string") {
                return { text: content.text, eof: content.eof === true };
            }
        }
        if (node.child) queue.push(node.child);
        if (node.sibling) queue.push(node.sibling);
    }
    return null;
}
