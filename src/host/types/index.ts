/**
 * Host half — shared type sections.
 *
 * Everything a behavior module consumes across a file boundary lives here; each
 * section is structural (the face actually read), never the upstream packages.
 */
export type { PluginContext, ProjectionRegistry, SettingsService } from "./services.js";
export type { HoverInfoStats, HoverInfoSessionRow } from "./stats.js";
export type { ProjectionHeader, SessionEvent } from "./projection.js";
