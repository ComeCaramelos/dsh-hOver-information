/**
 * Host half — the host services this plugin talks to.
 *
 * Every face here is the shape this half actually consumes — never the whole
 * upstream service. Widening them is a public-API change; narrowing is free.
 */
import type { Context } from "@deepseek-ai/cordis";
import type { hoverInfoProjectionDefinition } from "../projection/index.js";

/**
 * Host context as this plugin receives it: the plain `Context` surface plus the
 * reflection lookup `get`, which reaches any composed service (the loader's
 * context proxy mixes it in at runtime, and the remote halves resolve their
 * services through it). The lookup returns `any`: those faces belong to other
 * packages and are only ever read through guarded, shape-checked property
 * accesses (see ./remote/services.ts).
 */
export type PluginContext = Context & {
    /** Reflection lookup of one composed service (throws when unavailable). */
    get(name: string, strict?: boolean): any;
};

/**
 * The `settings` service face as this half consumes it. Only the section
 * install is read: the resolved snapshot reaches the browser through the
 * `settingsScope` service the client half injects, so no host-side consumer
 * is needed (docs/PLAN.md §5.3).
 */
export interface SettingsService {
    /** Publish one namespace: `base` is the bundle row's config layer. */
    installSection(
        owner: Context,
        namespace: string,
        schema: unknown,
        base: unknown,
        hooks: { setSource(source: () => unknown): void; onChange(): void },
    ): void;
}

/** The `sessionProjections` registry face as this half consumes it. */
export interface ProjectionRegistry {
    /** Register one projection unit definition (one `key` per host). */
    register(definition: ReturnType<typeof hoverInfoProjectionDefinition>): void;
}
