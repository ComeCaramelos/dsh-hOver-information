/**
 * @comecaramelos/dsh-hover-information — host half, public surface.
 *
 * Richer session hover cards: two corner icons (copy session id / copy
 * workspace path) and a configurable metrics block (turns, steps, tokens,
 * compactions, context, subagents, …) rendered on the stock session hover card,
 * configured from the Plugins page's row configuration page and fed by the
 * `hoverInfo` projection plus a `hoverInfo` Typert remote.
 *
 * Persistence boundary: the only durable state is the bundle row's own
 * configuration — the `showModelProvider` composer switch, the `refreshMs` cache
 * TTL, and one boolean per metric row (docs/PLAN.md §4/§5.3) — served as the
 * row's configuration form, every field defaulting so a row carrying nothing
 * answers what earlier builds answered. Since dsh 0.2.0 that configuration lives
 * in the profile patch: `settings.yaml` is gone, and every field the card edits
 * is a `.volatile()` field of the one `Config`. The metrics themselves are folded
 * in memory from each session's durable log and never persisted. Whether the
 * enhancement runs at all is the row's own answer, not a field here
 * (docs/PLAN.md §40).
 *
 * One plugin instance per dsh host: the row's profile entry id is fixed.
 *
 * Everything behind this surface lives in ./host/*:
 *
 *   ./host/apply.ts         the wiring (form attach + projection + remote)
 *   ./host/settings.ts      the form attach (entry-id rule + auto page off)
 *   ./host/schema.ts        the single row-config schema (every field volatile)
 *   ./host/projection/      the `hoverInfo` fold (state + wire view)
 *   ./host/remote/          the `hoverInfo` Typert remote (sessions + stats)
 *   ./host/constants.ts     fixed identifiers
 *   ./host/types/           shared type sections
 */

// ── identity ────────────────────────────────────────────────────────────────
export { inject, name } from "./host/plugin-meta.js";

// ── fixed identifiers ───────────────────────────────────────────────────────
export { CONFIG_FIELDS, ENTRY_ID, PLUGIN_ID } from "./host/constants.js";

// ── the row configuration ────────────────────────────────────────────────────
export { Config } from "./host/schema.js";
export { hoverInfoEntryId } from "./host/settings.js";

// ── the wiring ──────────────────────────────────────────────────────────────
export { apply } from "./host/apply.js";

// ── the components the tests and diagnostics drive directly ─────────────────
export { hoverInfoProjectionDefinition } from "./host/projection/index.js";
export { HoverInfoRemote } from "./host/remote/index.js";

// ── the shared views ────────────────────────────────────────────────────────
export type { ConfigValues } from "./host/schema.js";
export type {
    ConfigField,
    HoverInfoConfig,
    HoverInfoStats,
    HoverInfoSessionRow,
    PluginContext,
    ProjectionHeader,
    ProjectionRegistry,
    SessionEvent,
    SettingsService
} from "./host/types/index.js";
