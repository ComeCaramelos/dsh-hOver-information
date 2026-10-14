/**
 * Browser half — the configuration card stylesheet.
 *
 * The configuration body owns its own DOM classes, so they stay literal
 * (`dhiCard_*`) — the same stable-name rule as the overlay (see
 * ./hover-card.ts). Theme resolution is fine here: the body renders inside the
 * Plugins page (a normal surface), not inside the fixed-dark hover card.
 *
 * Since dsh 0.2.0 the body is rendered inside the Plugins page's own section,
 * which draws the container and the bundle's identity line — so there is no card
 * shell, no header and no chevron to style here. What is left is the block
 * layout the reference (`dsh-chrome-mcp`) composes configuration from:
 * `.catalog` blocks stacked in the body (the seam rule `.catalog + .catalog`
 * draws the hairline BETWEEN blocks only, so the stack never grows a second
 * one), and inside each block the two-row `.field` (`.fieldRow` = title +
 * controls inline above, `.fieldDesc` = copy full-width below).
 */

/** Class-name map, addressed by the components by logical part. */
export const CARD_CSS = {
    /** The page body: the catalog blocks stacked. */
    body: "dhiCard_body",
    badge: "dhiCard_badge",
    catalog: "dhiCard_catalog",
    field: "dhiCard_field",
    fieldRow: "dhiCard_fieldRow",
    fieldTitle: "dhiCard_fieldTitle",
    fieldDesc: "dhiCard_fieldDesc",
    toggleLabel: "dhiCard_toggleLabel",
    badges: "dhiCard_badges",
    reset: "dhiCard_reset",
    input: "dhiCard_input",
    inputInvalid: "dhiCard_inputInvalid",
    invalid: "dhiCard_invalid",
    grid: "dhiCard_grid",
    readOnly: "dhiCard_readOnly"
};

export const CARD_CSS_TEXT =
    // The body is the stack the page handed us — the page owns the container,
    // so this only lays the blocks out.
    `.${CARD_CSS.body}{flex-direction:column;gap:10px;display:flex}` +
    `.${CARD_CSS.badge}{color:var(--dsw-alias-label-secondary);border:.5px solid var(--dsw-alias-border-l4);border-radius:999px;font-size:11px;padding:1px 8px}` +
    // One catalog block (reference: `.catalog`) — two-row fields stacked inside,
    // with the hairline seam only between consecutive blocks.
    `.${CARD_CSS.catalog}{flex-direction:column;align-items:stretch;gap:10px;display:flex}` +
    `.${CARD_CSS.catalog} + .${CARD_CSS.catalog}{border-top:.5px solid var(--dsw-alias-border-l2);padding-top:12px}` +
    // Two-row field: title + controls inline above (`.fieldRow`), copy
    // full-width below (`.fieldDesc`) — the reference's uniform layout.
    `.${CARD_CSS.field}{align-items:flex-start;gap:4px;display:flex;flex-direction:column;width:100%}` +
    `.${CARD_CSS.fieldRow}{align-items:center;gap:8px;display:flex;width:100%}` +
    `.${CARD_CSS.fieldTitle}{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px;flex:1;min-width:0;cursor:pointer}` +
    `.${CARD_CSS.fieldDesc}{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;width:100%}` +
    `.${CARD_CSS.fieldDesc}.${CARD_CSS.invalid}{color:var(--dsw-alias-label-error)}` +
    // The switch wrapper — never stretch, it sits at the end of the inline row.
    `.${CARD_CSS.toggleLabel}{align-items:center;display:inline-flex;flex:none}` +
    `.${CARD_CSS.toggleLabel} input[type="checkbox"]{cursor:pointer}` +
    `.${CARD_CSS.badges}{align-items:center;gap:8px;display:inline-flex}` +
    `.${CARD_CSS.reset}{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;font-size:12px;padding:0}` +
    `.${CARD_CSS.reset}:hover:not(:disabled){color:var(--dsw-alias-label-primary)}` +
    `.${CARD_CSS.input}{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:8px;height:28px;padding:0 10px;font:inherit;font-size:14px;line-height:22px;flex:none;width:96px}` +
    `.${CARD_CSS.input}:disabled{cursor:default;opacity:.5}` +
    `.${CARD_CSS.input}:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}` +
    `.${CARD_CSS.input}.${CARD_CSS.inputInvalid}{border-color:var(--dsw-alias-label-error)}` +
    // Metric toggles stay TWO-COLUMN inside the last catalog, filled
    // column-major over ceil(n/2) rows set inline (so DOM order stays METRICS
    // order). Each cell is a `.field` carrying just its `.fieldRow`;
    // `flex-wrap` lets label + Overridden + reset break within a narrow cell.
    `.${CARD_CSS.grid}{grid-template-columns:minmax(0,1fr) minmax(0,1fr);grid-auto-flow:column;column-gap:16px;row-gap:8px;align-items:start;width:100%;display:grid}` +
    `.${CARD_CSS.grid} .${CARD_CSS.field} .${CARD_CSS.fieldRow}{flex-wrap:wrap}` +
    `.${CARD_CSS.readOnly}{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px}`;
