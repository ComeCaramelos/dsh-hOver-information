/**
 * The public surface of the BROWSER half — re-export only; it decides
 * nothing.
 *
 * `apply` mounts every piece (locales, the settings card, the hover-card and
 * document-preview enhancer); `inject` is the service list the shell must
 * resolve before `apply` runs. The two budgets are exported because the
 * browser-side cache TTL is pinned against them by tests.
 */
export { apply } from "./apply.js";
export { inject } from "./plugin-meta.js";
/** Cache budgets pinned against host defaults by test/client.test.mjs. */
export { DEFAULT_REFRESH_MS, FAILURE_RETRY_MS } from "./constants.js";
