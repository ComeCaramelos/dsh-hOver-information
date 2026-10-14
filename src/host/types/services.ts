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
 * The `settings` service face as this half consumes it. Since dsh 0.2.0 this is
 * the profile configuration **form** service — one form per profile entry, keyed
 * by the entry id, with the row config as its base layer and the profile patch
 * as its user layer (`settings.yaml` is gone).
 *
 * This half makes exactly one call on it, and reads nothing else off it: the
 * browser half reaches the same document through its own `configForms` service,
 * so the only thing the host needs is to keep the Host-generated configuration
 * page off while the row's own page stands (see ../settings.ts).
 */
export interface SettingsService {
    /**
     * Presentation policy for the entry the owning fiber stands for.
     * `auto: false` keeps the generated page off while the row owns its page.
     * Disposable — and calling it twice for one fiber throws.
     */
    configure(presentation: { auto?: boolean }, owner?: unknown): () => void;
}

/** The `sessionProjections` registry face as this half consumes it. */
export interface ProjectionRegistry {
    /** Register one projection unit definition (one `key` per host). */
    register(definition: ReturnType<typeof hoverInfoProjectionDefinition>): void;
}
