/**
 * Browser half — the `en` dictionary.
 *
 * Every string the enhancer renders (card rows, button labels, card copy) is
 * resolved through the `hoverInfo` locale namespace; keys not in this table fall
 * open to the key itself, never to a crash.
 */
export const en = {
    title: "Hover information",
    description: "Extra lines on session hover cards.",
    active: "Active",
    activeHint: "Show the extra lines on session hover cards. Off leaves the stock card untouched.",
    previewTools: "Sidebar preview buttons",
    previewToolsHint: "Add copy-content and copy-path buttons to the sidebar file-preview header. Off leaves the preview header untouched.",
    modelProvider: "Composer model selector",
    modelProviderHint: "Show the current selection as `provider > model` in the composer model selector's tooltip. Off leaves the standard tooltip untouched.",
    jobKill: "Background job kill",
    jobKillHint: "Add a kill button to the running rows of the session header's background-job list. Off leaves the job list untouched.",
    refresh: "Refresh interval (ms)",
    refreshHint: "How often open cards refresh their metrics (1000-60000 ms).",
    refreshInvalid: "Enter a whole number between 1000 and 60000.",
    overridden: "Overridden",
    reset: "Reset",
    readOnly: "Settings are read-only in this deployment.",
    expand: "Expand",
    collapse: "Collapse",
    copySessionId: "Copy session ID",
    copyWorkspacePath: "Copy workspace path",
    copyFileContent: "Copy file content",
    copyFilePath: "Copy file path",
    killJob: "Kill background job",
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
