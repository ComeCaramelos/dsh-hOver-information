/**
 * Browser half — the card's field specs.
 *
 * The field list is the SETTINGS shape this half exposes: the master switch,
 * the sidebar-preview tools switch, the composer model-selector provider
 * switch, one boolean per metric row (so DOM order stays METRICS order), and
 * the refreshMs integer. `fieldSpec`/`parseRefreshMs` are pure lookups used by
 * the controller; the component only renders through them.
 */
import { METRICS } from "../metrics.js";

export interface CardFieldSpec {
    field: string;
    kind: "bool" | "int";
    /** Locale key for the metric rows (the master switch is labelled directly). */
    labelKey?: string;
    min?: number;
    max?: number;
}

export const CARD_FIELDS: CardFieldSpec[] = [
    { field: "active", kind: "bool" },
    { field: "showPreviewTools", kind: "bool" },
    { field: "showModelProvider", kind: "bool" },
    { field: "showJobKill", kind: "bool" }
];
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
