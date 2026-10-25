/**
 * Browser half — identity.
 *
 * The identifiers are contracts with the host half: the profile entry id keys
 * this row's configuration form, the locale namespace is the lookup root for
 * every string this half renders, and the plugin id tags every DOM node this
 * half owns. The browser half is emitted as its own bundle and cannot import
 * ./host/constants.ts, so they are mirrored here — keep both sides in step.
 */

/** Profile entry id the host half keys its configuration form by. */
export const ENTRY_ID = "hover-info";

/** Locale dictionary namespace this half registers and renders from. */
export const LOCALE_NAMESPACE = "hoverInfo";

/** Workspace-browser locale namespace (source of the stock time labels). */
export const WORKSPACE_NAMESPACE = "workspace";

/** npm id of this bundle; tags the injected `style` elements and DOM nodes. */
export const PLUGIN_ID = "@comecaramelos/dsh-hover-information";

