/**
 * Host-half plugin identity.
 *
 * `name` is what the cordis loader reports for diagnostics and `inject` is the
 * list of host services this half needs of its own before applying: the
 * `settings` service whose `installSection` publishes the `hover-info`
 * namespace. The projection registry and the Typert remote resolve themselves
 * (see `./apply.ts`), so they stay off this list.
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = "hover-info";

/** Host services this half resolves before applying. */
export const inject = ["settings"];
