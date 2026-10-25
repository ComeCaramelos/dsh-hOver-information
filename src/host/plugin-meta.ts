/**
 * Host-half plugin identity.
 *
 * `name` is what the cordis loader reports for diagnostics. `inject` is empty on
 * purpose: since dsh 0.2.0 nothing is needed eagerly before `apply`. The
 * configuration form (`./settings.ts`), the projection registry and the Typert
 * remote each resolve their own service lazily — the form inside one fiber
 * effect, the remote through the reflection lookup — so a host that composes
 * none of them costs that half alone instead of failing the whole plugin row.
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = "hover-info";

/** Host services this half resolves before applying — none eagerly. */
export const inject: string[] = [];
