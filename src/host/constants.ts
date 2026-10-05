/**
 * Host half — fixed identifiers.
 *
 * These are contracts with the browser half: the settings namespace is also the
 * card's slot key, and the bundle id tags every DOM node the browser half owns.
 * The browser half is emitted as its own bundle and cannot import this module,
 * so `src/client/plugin-meta.ts` mirrors them — a drift there breaks the card
 * silently, so keep both sides in step.
 */

/** npm id of this bundle; tags the injected `style` elements and DOM nodes. */
export const PLUGIN_ID = "@comecaramelos/dsh-hover-information";

/** Settings namespace served to the browser; also the card's slot key. */
export const SETTINGS_NAMESPACE = "hover-info";
