/**
 * Browser half — the settings card stylesheet.
 *
 * The card owns its own DOM classes, so they stay literal (`dhiCard_*`) — the
 * same stable-name rule as the overlay (see ./hover-card.ts). Theme resolution
 * is fine here: the card renders inside the Settings page (a normal surface),
 * not inside the fixed-dark hover card.
 *
 * The block layout is the reference card's (`dsh-chrome-mcp`): `.catalog`
 * blocks stacked in the body (the seam rule `.catalog + .catalog` draws the
 * hairline BETWEEN blocks only — the body already carries the card's top
 * rule, so a catalog never adds a second one), and inside each block the
 * two-row `.field` (`.fieldRow` = title + controls inline above, `.fieldDesc`
 * = copy full-width below).
 */

/** Class-name map, addressed by the card component by logical part. */
export const CARD_CSS = {
    card: "dhiCard_card",
    cardOpen: "dhiCard_cardOpen",
    header: "dhiCard_header",
    headText: "dhiCard_headText",
    nameRow: "dhiCard_nameRow",
    name: "dhiCard_name",
    badge: "dhiCard_badge",
    desc: "dhiCard_desc",
    chevron: "dhiCard_chevron",
    chevronOpen: "dhiCard_chevronOpen",
    body: "dhiCard_body",
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
    `.${CARD_CSS.card}{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);border-radius:16px;list-style:none;transition:border-color .16s,background .16s}` +
    `.${CARD_CSS.card}:hover{border-color:var(--dsw-alias-label-dimmed)}` +
    `.${CARD_CSS.cardOpen}{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}` +
    `.${CARD_CSS.header}{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}` +
    `.${CARD_CSS.header}:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}` +
    `.${CARD_CSS.headText}{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}` +
    `.${CARD_CSS.nameRow}{align-items:center;gap:8px;min-width:0;display:flex}` +
    `.${CARD_CSS.name}{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}` +
    `.${CARD_CSS.badge}{color:var(--dsw-alias-label-secondary);border:.5px solid var(--dsw-alias-border-l4);border-radius:999px;font-size:11px;padding:1px 8px}` +
    `.${CARD_CSS.desc}{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}` +
    `.${CARD_CSS.chevron}{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}` +
    `.${CARD_CSS.chevronOpen}{transform:rotate(180deg)}` +
    `.${CARD_CSS.body}{border-top:.5px solid var(--dsw-alias-border-l2);flex-direction:column;gap:10px;margin:0 16px;padding:12px 0;display:flex}` +
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
    // Metric toggles stay TWO-COLUMN inside the second catalog, filled
    // column-major over ceil(n/2) rows set inline (so DOM order stays METRICS
    // order). Each cell is a `.field` carrying just its `.fieldRow`;
    // `flex-wrap` lets label + Overridden + reset break within a narrow cell.
    `.${CARD_CSS.grid}{grid-template-columns:minmax(0,1fr) minmax(0,1fr);grid-auto-flow:column;column-gap:16px;row-gap:8px;align-items:start;width:100%;display:grid}` +
    `.${CARD_CSS.grid} .${CARD_CSS.field} .${CARD_CSS.fieldRow}{flex-wrap:wrap}` +
    `.${CARD_CSS.readOnly}{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px}`;
