/**
 * @comecaramelos/dsh-hover-information — host half, public surface.
 *
 * Richer session hover cards: two corner icons (copy session id / copy
 * workspace path) and a configurable metrics block (turns, steps, tokens,
 * compactions, context, subagents, …) rendered on the stock session hover card,
 * configured from a Settings → Plugins card and fed by the `hoverInfo`
 * projection plus a `hoverInfo` Typert remote.
 *
 * Persistence boundary: the only durable state is the `hover-info` settings
 * namespace — the `active` master switch, the `refreshMs` cache TTL, and one
 * boolean per metric row (docs/PLAN.md §4/§5.3), every field defaulting so
 * stored snapshots from earlier builds resolve unchanged. The metrics themselves
 * are folded in memory from each session's durable log and never persisted.
 *
 * One plugin instance per dsh host: the settings namespace is fixed.
 *
 * Everything behind this surface lives in ./host/*:
 *
 *   ./host/apply.ts         the wiring (section + projection + remote)
 *   ./host/settings.ts      namespace install (base layer = the row config)
 *   ./host/schema.ts        the settings-section schema
 *   ./host/projection/      the `hoverInfo` fold (state + wire view)
 *   ./host/remote/          the `hoverInfo` Typert remote (sessions + stats)
 *   ./host/constants.ts     fixed identifiers
 *   ./host/types/           shared type sections
 */

// ── identity ────────────────────────────────────────────────────────────────
export { inject, name } from "./host/plugin-meta.js";

// ── fixed identifiers ───────────────────────────────────────────────────────
export { PLUGIN_ID, SETTINGS_NAMESPACE } from "./host/constants.js";

// ── the settings section ────────────────────────────────────────────────────
export { Config, SettingsSchema } from "./host/schema.js";

// ── the wiring ──────────────────────────────────────────────────────────────
export { apply } from "./host/apply.js";

// ── the components the tests and diagnostics drive directly ─────────────────
export { hoverInfoProjectionDefinition } from "./host/projection/index.js";
export { HoverInfoRemote } from "./host/remote/index.js";

// ── the shared views ────────────────────────────────────────────────────────
export type { Settings } from "./host/schema.js";
export type {
    HoverInfoStats,
    HoverInfoSessionRow,
    PluginContext,
    ProjectionHeader,
    ProjectionRegistry,
    SessionEvent,
    SettingsService
} from "./host/types/index.js";
