/**
 * Browser half — the metric row spec + formatting.
 *
 * `field` is the settings key toggled in the Settings → Plugins card; `key`
 * selects the row's format inside {@link rowValues}; `labelKey` is the locale
 * dictionary key rendered on the card row. Formats are pure functions of a
 * stats view — the same rows render from a live `hoverInfo/stats` answer or
 * from the cached projection the session-list row carries.
 */

/** Metric row spec: `field` is the settings key; format by key. */
export interface MetricRow {
    /** Settings key that toggles the row. */
    field: string;
    /** Row format key, resolved inside `rowValues`. */
    key: string;
    /** Locale dictionary key of the rendered label. */
    labelKey: string;
}

export const METRICS: MetricRow[] = [
    { field: "showTurns", key: "turns", labelKey: "metricTurns" },
    { field: "showSteps", key: "steps", labelKey: "metricSteps" },
    { field: "showTokensIn", key: "tokensIn", labelKey: "metricTokensIn" },
    { field: "showTokensOut", key: "tokensOut", labelKey: "metricTokensOut" },
    { field: "showCacheRead", key: "cacheRead", labelKey: "metricCacheRead" },
    { field: "showCompactions", key: "compactions", labelKey: "metricCompactions" },
    { field: "showPurges", key: "purges", labelKey: "metricPurges" },
    { field: "showToolCalls", key: "toolCalls", labelKey: "metricToolCalls" },
    { field: "showActiveTime", key: "activeTime", labelKey: "metricActiveTime" },
    { field: "showContext", key: "context", labelKey: "metricContext" },
    { field: "showSubagents", key: "subagents", labelKey: "metricSubagents" },
    { field: "showModel", key: "model", labelKey: "metricModel" },
    { field: "showCreatedAt", key: "createdAt", labelKey: "metricCreatedAt" }
];

/** Compact token count: 1200 → "1.2k", 3400000 → "3.4M", 950 → "950". */
export function formatTokens(value: unknown): string {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return "0";
    if (n < 1000) return String(Math.round(n));
    const units: Array<readonly [number, string]> = [
        [1e12, "T"],
        [1e9, "B"],
        [1e6, "M"],
        [1e3, "k"]
    ];
    for (let i = 0; i < units.length; i++) {
        const scale = units[i][0];
        if (n >= scale) {
            const scaled = n / scale;
            return (scaled >= 100 ? String(Math.round(scaled)) : String(Math.round(scaled * 10) / 10)) + units[i][1];
        }
    }
    return String(Math.round(n));
}

/** Compact duration from milliseconds: "4m 12s", "1h 03m", "52s". */
export function formatDuration(ms: unknown): string {
    const total = Math.max(0, Math.round(Number(ms) || 0) / 1000);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = Math.floor(total % 60);
    const pad = (n: number) => (n < 10 ? "0" : "") + n;
    if (hours > 0) return hours + "h " + pad(minutes) + "m";
    if (minutes > 0) return minutes + "m " + pad(seconds) + "s";
    return seconds + "s";
}

/** Short absolute date for the Created row: "2026-09-01". */
export function formatDate(epochMs: unknown): string {
    const d = new Date(Number(epochMs) || 0);
    const month = d.getMonth() + 1;
    const day = d.getDate();
    return d.getFullYear() + "-" + (month < 10 ? "0" : "") + month + "-" + (day < 10 ? "0" : "") + day;
}

/**
 * Resolve one row's rendered value from a stats view; null when the row has
 * nothing to show yet (omit the row — never show a fake zero for a metric the
 * fold has not sampled).
 */
export function rowValues(row: MetricRow, view: any): { value: string; bar?: { percent: number; tone: string } } | null {
    if (!view) return null;
    switch (row.key) {
        case "turns":
            return Number(view.turns) ? { value: String(view.turns) } : null;
        case "steps":
            return Number(view.steps) ? { value: String(view.steps) } : null;
        case "toolCalls":
            return Number(view.toolCalls) ? { value: String(view.toolCalls) } : null;
        case "compactions":
            return Number(view.compactions) ? { value: String(view.compactions) } : null;
        case "purges":
            return Number(view.purges) ? { value: String(view.purges) } : null;
        case "tokensIn":
            return Number(view.tokensIn) ? { value: formatTokens(view.tokensIn) } : null;
        case "tokensOut":
            return Number(view.tokensOut) ? { value: formatTokens(view.tokensOut) } : null;
        case "cacheRead":
            return Number(view.cacheRead) ? { value: formatTokens(view.cacheRead) } : null;
        case "activeTime": {
            const total = (Number(view.llmMs) || 0) + (Number(view.toolMs) || 0);
            return total > 0 ? { value: formatDuration(total) } : null;
        }
        case "subagents": {
            const spawned = Number(view.subagentsSpawned) || 0;
            const running = Number(view.subagentsRunning) || 0;
            if (spawned === 0 && running === 0) return null;
            return { value: running > 0 ? spawned + " (" + running + " running)" : String(spawned) };
        }
        case "model": {
            const model = view.lastRequest && typeof view.lastRequest.model === "string" ? view.lastRequest.model : null;
            return model ? { value: model } : null;
        }
        case "createdAt": {
            const created = Number(view.createdAt) || 0;
            return created > 0 ? { value: formatDate(created) } : null;
        }
        case "context": {
            const sample = view.lastContext;
            if (!sample || !Number(sample.tokens)) return null;
            const tokens = formatTokens(sample.tokens);
            const request = view.lastRequest;
            const window = request && typeof request.contextWindow === "number" && request.contextWindow > 0 ? request.contextWindow : null;
            if (window === null) return { value: tokens + " tokens" };
            // Integer percent — `Math.min(100, Math.round(used / window * 100))`,
            // the figure the stock context meter renders, so the card row and
            // the composer meter never disagree by a rounding step.
            const percent = Math.min(100, Math.round((Number(sample.tokens) * 100) / window));
            const tone = percent < 70 ? "dhi-ctxfill" : percent < 90 ? "dhi-ctxfill dhi-ctxfill-warn" : "dhi-ctxfill dhi-ctxfill-error";
            return { value: tokens + " / " + formatTokens(window) + " · " + percent + "%", bar: { percent: percent, tone: tone } };
        }
        default:
            return null;
    }
}
