/**
 * Host half — the `hoverInfo` projection: the per-session wire view.
 *
 * Structural views this plugin serves/consumes; the behavior modules own the
 * shapes, these describe what reaches the browser (docs/PLAN.md §4/§6.2).
 */
import type { HoverInfoView } from "../projection/state.js";

/**
 * Metric view served to the browser: the `hoverInfo` wire projection plus the
 * one live-only field the fold cannot carry — how many subagent children of
 * this session are running right now.
 */
export type HoverInfoStats = HoverInfoView & { subagentsRunning: number };

/**
 * One live session row served to the browser (docs/PLAN.md §6.2). The whole
 * row is optional-tolerant: every field falls back to `null` rather than
 * throwing, so one half-resolved session never kills the list.
 */
export interface HoverInfoSessionRow {
    /** Session id. */
    id: string;
    /** Generated title, or null before the first title lands. */
    title: string | null;
    /** Activity time — `max(createdAt, lastPromptAt)`. */
    updatedAt: number;
    /** Whether the live agent is running. */
    running: boolean;
    /** Workspace root, or null when the header carries none. */
    cwd: string | null;
    /** Creation time, or null. */
    createdAt: number | null;
}
