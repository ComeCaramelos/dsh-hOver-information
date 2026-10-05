/**
 * Browser half — relative-time bucketing.
 *
 * Buckets the same thresholds the shell's relativeTime uses; only the
 * DOM-visible distance bucket is needed (the duplicate-title tie-break
 * label, see ./identify.ts).
 */
export interface TimeBucket {
    unit: "now" | "minutes" | "hours" | "days" | "months" | "years";
    n: number;
}

export function relativeBucket(updatedAt: number, now: number): TimeBucket {
    var delta = Math.max(0, now - updatedAt);
    if (delta < 6e4) return { unit: "now", n: 0 };
    if (delta < 36e5) return { unit: "minutes", n: Math.floor(delta / 6e4) };
    if (delta < 864e5) return { unit: "hours", n: Math.floor(delta / 36e5) };
    if (delta < 30 * 864e5) return { unit: "days", n: Math.floor(delta / 864e5) };
    if (delta < 365 * 864e5) return { unit: "months", n: Math.floor(delta / (30 * 864e5)) };
    return { unit: "years", n: Math.floor(delta / (365 * 864e5)) };
}
