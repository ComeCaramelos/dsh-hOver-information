/**
 * Browser half — the `en` dictionary.
 *
 * Every string the enhancer renders (card rows, button labels, card copy) and
 * the configuration card renders is resolved through the `hoverInfo` locale
 * namespace; keys not in this table fall open to the key itself, never to a
 * crash.
 *
 * The configuration card carries no `title`/`description`: the Plugins page
 * draws the bundle's identity line (its crumb, artwork, name and the package
 * description) above it.
 */
export const en = {
    modelProvider: "Composer model selector",
    modelProviderHint: "Show the current selection as `provider > model` in the composer model selector's tooltip. Off leaves the standard tooltip untouched.",
    refresh: "Refresh interval (ms)",
    refreshHint: "How often open cards refresh their metrics (1000-60000 ms).",
    refreshInvalid: "Enter a whole number between 1000 and 60000.",
    overridden: "Overridden",
    reset: "Reset",
    readOnly: "Configuration is read-only for a row this deployment overrides elsewhere.",
    copySessionId: "Copy session ID",
    copyWorkspacePath: "Copy workspace path",
    metricTurns: "Turns",
    metricSteps: "Steps",
    metricTokensIn: "Sent",
    metricTokensOut: "Received",
    metricCacheRead: "Cache",
    metricCompactions: "Compactions",
    metricPurges: "Purges",
    metricToolCalls: "Tool calls",
    metricActiveTime: "Active",
    metricContext: "Context",
    metricSubagents: "Subagents",
    metricModel: "Model",
    metricCreatedAt: "Created"
};
