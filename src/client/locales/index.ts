/**
 * Browser half — the locale surface.
 *
 * The `hoverInfo` namespace is registered from this table; the dictionary is
 * keyed by tag (`en`), exactly what `ctx.locale.register` takes.
 */
import { en } from "./en-US.js";

export const DICTIONARIES: Record<string, Record<string, string>> = { en };
