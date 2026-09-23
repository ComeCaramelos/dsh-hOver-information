/**
 * Browser half — identity and the services the shell must resolve.
 *
 * The identifiers are contracts with the host half: the settings namespace key
 * is also the card's slot key, the locale namespace is the lookup root for every
 * string this half renders, and the plugin id tags every DOM node this half
 * owns. The browser half is emitted as its own bundle and cannot import
 * ./host/constants.ts, so they are mirrored here — keep both sides in step.
 */

/** Fixed settings namespace served by the host half; also the slot key. */
export const SETTINGS_NAMESPACE = "hover-info";

/** Locale dictionary namespace this half registers and renders from. */
export const LOCALE_NAMESPACE = "hoverInfo";

/** Workspace-browser locale namespace (source of the stock time labels). */
export const WORKSPACE_NAMESPACE = "workspace";

/** npm id of this bundle; tags the injected `style` elements and DOM nodes. */
export const PLUGIN_ID = "@comecaramelos/dsh-hover-information";

/**
 * Services the shell must resolve before `apply` runs: the sessions store
 * (identity + the `hoverInfo` projection hint), the connection (the RPC
 * envelope the stats live fetch rides), the locale service (copy), the
 * settings scope (the card's whole data source) and the slots service (where
 * the card is registered).
 */
export const inject = ["sessions", "connection", "locale", "settingsScope", "slots"];
