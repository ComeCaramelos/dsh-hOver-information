/**
 * Browser half — the card's field specs.
 *
 * The field list is the SETTINGS shape this half exposes: the composer
 * model-selector provider switch, one boolean per metric row (so DOM order
 * stays METRICS order), and the refreshMs integer. `fieldSpec`/`parseRefreshMs`
 * are pure lookups the card's bind projects and commits through (./body.ts);
 * the component only renders through them.
 *
 * There is no master switch: turning this plugin off is the Plugins page
 * disabling the bundle row, which takes `apply` out altogether (docs/PLAN.md
 * §40) — a second switch here would only disagree with it.
 */
import { METRICS } from "../metrics.js";

export interface CardFieldSpec {
    field: string;
    kind: "bool" | "int";
    /** Locale key for the rows labelled from their own string (the metrics). */
    labelKey?: string;
    min?: number;
    max?: number;
}

export const CARD_FIELDS: CardFieldSpec[] = [{ field: "showModelProvider", kind: "bool" }];
for (let mi = 0; mi < METRICS.length; mi++) CARD_FIELDS.push({ field: METRICS[mi].field, kind: "bool", labelKey: METRICS[mi].labelKey });
CARD_FIELDS.push({ field: "refreshMs", kind: "int", min: 1000, max: 60000 });

export function fieldSpec(name: string): CardFieldSpec | null {
    for (let i = 0; i < CARD_FIELDS.length; i++) if (CARD_FIELDS[i].field === name) return CARD_FIELDS[i];
    return null;
}

export function parseRefreshMs(text: string, spec: CardFieldSpec | null): number | null {
    const trimmed = String(text).trim();
    if (trimmed === "") return null;
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed) || spec === null || parsed < (spec.min as number) || parsed > (spec.max as number)) return null;
    return parsed;
}
