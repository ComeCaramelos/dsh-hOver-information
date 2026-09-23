/**
 * Browser half — the metrics block.
 *
 * A block is rendered only from rows that are (1) enabled by the settings
 * scope and (2) currently non-empty (`rowValues` returns null for metrics the
 * fold has not sampled — never show a fake zero). The rendered signature
 * makes a settled re-sync a no-op: DOM writes happen only when the block
 * actually changes, otherwise the card's own observer would loop on DOM churn
 * (see the sync rules in ./hover-card.ts).
 */
import { METRICS, rowValues } from "../metrics.js";
import { translateSelf } from "./host.js";

/** One rendered row: the spec row plus its formatted value. */
export interface RenderedRow {
    row: { field: string; key: string; labelKey: string };
    value: { value: string; bar?: { percent: number; tone: string } };
}

/** Rendered metric rows for a view: enabled, non-empty, DOM order. */
export function metricRows(env: { metricEnabled: Record<string, boolean> }, view: any): RenderedRow[] {
    var rows: RenderedRow[] = [];
    for (var i = 0; i < METRICS.length; i++) {
        var row = METRICS[i];
        if (!env.metricEnabled[row.field]) continue;
        var value = rowValues(row, view);
        if (value === null) continue;
        rows.push({ row: row, value: value });
    }
    return rows;
}

/** Identity of a rendered block; equal signatures need no DOM write. */
export function metricsSignature(rows: RenderedRow[]): string {
    var parts = [];
    for (var i = 0; i < rows.length; i++) parts.push(rows[i].row.key + "=" + rows[i].value.value);
    return parts.join("\n");
}

/** Build one metrics block element from rendered rows; null if none. */
export function buildMetricsBlock(env: { doc: any; ctx: any }, rows: RenderedRow[]): any {
    var block = null;
    for (var i = 0; i < rows.length; i++) {
        var row = rows[i].row;
        var value = rows[i].value;
        if (block === null) {
            block = env.doc.createElement("div");
            block.className = "dhi-metrics";
            block.setAttribute("data-hi-metrics", "1");
        }
        var line = env.doc.createElement("div");
        line.className = value.bar ? "dhi-mrow-context" : "dhi-mrow";
        line.setAttribute("data-hi-metric", row.key);
        var k = env.doc.createElement("span");
        k.className = "dhi-k";
        k.textContent = translateSelf(env, row.labelKey);
        var v = env.doc.createElement("span");
        v.className = "dhi-v";
        v.textContent = value.value;
        line.appendChild(k);
        line.appendChild(v);
        if (value.bar) {
            var bar = env.doc.createElement("div");
            bar.className = "dhi-ctxbar";
            var fill = env.doc.createElement("div");
            fill.className = value.bar.tone;
            fill.style.width = Math.max(0, Math.min(100, value.bar.percent)) + "%";
            bar.appendChild(fill);
            line.appendChild(bar);
        }
        block.appendChild(line);
    }
    return block;
}
