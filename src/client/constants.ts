/**
 * Browser half — fixed identifiers.
 *
 * Structural fingerprints and stable shell anchors — never hashed CSS-module
 * class names — plus the caches' own timings. Everything here is a contract
 * with the stock shell or with the DOM the enhancer itself builds.
 */

/** Structural fingerprint: the stock hover card is exactly this wide. */
export const HOVER_CARD_WIDTH = 244;

/**
 * Structural anchors for the stock document preview: stable shell data
 * attributes, never the hashed `*Header`/`*tool` CSS-module classes (same rule
 * as the hover card, docs/PLAN.md §13). `data-document-preview` marks the
 * preview root (value = the active renderer id); `data-textpreview-path` marks
 * the header path element, whose `title` carries the absolute display path.
 */
export const PREVIEW_ROOT_ATTR = "data-document-preview";
export const PREVIEW_PATH_ATTR = "data-textpreview-path";

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

/**
 * DOM contract for the background-job list (the shell's `JobListAction`,
 * registered by `@deepseek-ai/dsh-client-ui-jobs` in the session header).
 *
 * The list is anchored by its own localized `aria-label`, resolved through
 * the SHELL's `job` locale namespace (key `list.aria` — what the component
 * itself renders), never a hash-prefixed CSS-module class (same rule as the
 * hover card, docs/PLAN.md §13). A `ul` is a menu only when its `li` rows
 * carry a fiber key naming a job the live store actually owns, so a stray
 * `ul` that happens to wear the same label still resolves nothing (fail-open).
 */
export const JOB_LIST_LOCALE_NAMESPACE = "job";
export const JOB_LIST_LABEL_KEY = "list.aria";

/** The live store's per-session job rows (`snapshot.jobsBySession`). */
export const JOB_LIVE_STATUSES = ["running", "stopping"];

/**
 * DOM contract for the injected per-row kill button. Its attribute pairs the
 * row with its job id (re-identification + the test handle); the class names
 * the sheet's fixed-palette button.
 */
export const JOB_KILL_ATTR = "data-hi-jobkill";
export const JOB_KILL_ID_ATTR = "data-hi-job";

/** How long the check mark replaces the icon after a settled kill request. */
export const KILL_FEEDBACK_MS = 1300;

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
