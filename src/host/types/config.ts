/**
 * Host half — the config `apply` receives.
 *
 * One `Config` (./../schema.ts) carries everything the row serves, and every
 * field of it is `.volatile()`. What matters is the **shape at runtime**: dsh
 * 0.2.0 hands `apply` a live reference for every volatile field and the plain
 * value for every ordinary one, so reading the type is not reading what the
 * field holds. Nothing answers for the running metrics here — the host serves
 * every metric regardless of configuration, so no consumer ever reads a
 * reference — but the shape is what a diagnostic or a test hands in, so it is
 * named rather than left `any`.
 */
import type { ConfigValues } from "../schema.js";

/** A `.volatile()` field as `apply` hands it: a live reference the fiber
 * resolves, or — the shape a hand-built config (or a test) hands — the plain
 * value itself. */
export type ConfigField<T> = T | { get(): T };

/** The row config as `apply` sees it: every field a live reference. */
export type HoverInfoConfig = {
    [K in keyof ConfigValues]-?: ConfigField<ConfigValues[K]>;
};
