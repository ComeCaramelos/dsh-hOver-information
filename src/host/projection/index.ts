/**
 * Host half — the `hoverInfo` projection: definition face.
 *
 * Assembles the three sections:
 *   ./state.ts   zod state/view schemas + the initial state
 *   ./fold.ts    one-event fold + the wire projection
 * the definition itself lives here.
 */
import { hoverInfoApply, hoverInfoView } from "./fold.js";
import { hoverInfoInitialState, hoverInfoStateSchema, hoverInfoViewSchema } from "./state.js";
import type { ProjectionHeader } from "../types/projection.js";

/**
 * Build the projection definition. Exported as a factory (rather than a
 * frozen constant) so `apply()` registers exactly one instance per mount.
 * @returns a `ProjectionDefinition` consumable by `ctx.sessionProjections.register()`.
 */
export function hoverInfoProjectionDefinition() {
    return {
        key: "hoverInfo",
        // v2 adds the `purges` fold (`compaction/prune`). The registry's
        // checkpoint stores each row's `ver = stateVersion` and only refolds
        // from seq 0 when the stored `ver` no longer matches the live unit;
        // bumping is what makes already-checkpointed sessions re-fold the
        // prune events sitting in their older log instead of resuming the
        // pre-purges state with `purges` pinned at 0 forever.
        stateVersion: 2,
        stateSchema: hoverInfoStateSchema,
        init: (header: ProjectionHeader) => hoverInfoInitialState(
            typeof header?.createdAt === "number" ? header.createdAt : null
        ),
        apply: hoverInfoApply,
        wire: {
            viewSchema: hoverInfoViewSchema,
            view: hoverInfoView
        }
    };
}
