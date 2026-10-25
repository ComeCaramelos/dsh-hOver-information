/**
 * Browser half — fixed identifiers.
 *
 * Structural fingerprints and stable shell anchors — never hashed CSS-module
 * class names — plus the caches' own timings. Everything here is a contract
 * with the stock shell or with the DOM the enhancer itself builds.
 */

/** Structural fingerprint: the stock hover card is exactly this wide. */
export const HOVER_CARD_WIDTH = 244;

/** How long the check mark replaces the icon after a copy. */
export const COPY_FEEDBACK_MS = 1300;

/** Default cache TTL; mirrors the host settings default. */
export const DEFAULT_REFRESH_MS = 30000;

/**
 * Ceiling on how long a *failed* live-stats attempt suppresses the next one.
 * A live miss is usually transient — the session is not loaded in the host
 * yet, or the gateway is still warming up — so those attempts retry on this
 * clock instead of the full TTL; a card opened during a cold start would
 * otherwise stay blank for `refreshMs` (30 s by default) although the answer is
 * one round trip away. A settled *hit* keeps the full TTL.
 */
export const FAILURE_RETRY_MS = 3000;

/** The lazy sweep heartbeat cadence (started with the first open card). */
export const SWEEP_INTERVAL_MS = 1000;

/** The injected overlay's `style` tag identity. */
export const HOVER_CSS_TAG = "@comecaramelos/dsh-hover-information/hoverEnhancer.css";

/** The settings card's `style` tag identity. */
export const CARD_CSS_TAG = "@comecaramelos/dsh-hover-information/HoverInformationCard.module.css";

/**
 * DOM contract for the composer model selector (docs/PLAN.md §33).
 *
 * The seat's `data-slot="conversation.input.model"` anchor is the only stable
 * attribute on this surface; the trigger button and the root menu's two cells
 * carry NO provider text at all, so identity is resolved through the fiber
 * fast-path (see `enhancer/model.ts`). Their hashed classes are matched only by
 * their component-name SUFFIXES (`class$="_trigger"` / `class$="_cell"`
 * semantics) — the hash prefix is never consulted, and the trigger is anchored
 * on its `data-slot` so a stray `_trigger` class elsewhere cannot be enhanced.
 */
export const MODEL_SEAT_ATTR = "data-slot";
export const MODEL_SEAT_VALUE = "conversation.input.model";
export const MODEL_TRIGGER_SUFFIX = "_trigger";
export const MODEL_CELL_SUFFIX = "_cell";
export const MODEL_CELL_VALUE_SUFFIX = "_cellValue";

/** Roles the selector's menu items carry; used only for the DOM fallback. */
export const MODEL_MENUITEM_ROLE = "menuitem";
export const MODEL_OPTION_ROLE = "menuitemradio";
