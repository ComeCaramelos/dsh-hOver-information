/**
 * Browser half — the hover-card overlay stylesheet.
 *
 * Fixed-dark palette on purpose (docs/PLAN.md §9): the stock card surface is
 * fixed-dark in BOTH themes (`--dsw-hovercard-bg: #2C2C2E`, a literal with no
 * theme variant — a popover-style inverted surface, like its white title), so
 * the overlay must NOT resolve theme aliases: on the light theme an alias
 * label is a dark value and would sit invisible on the dark card. Fixed
 * palette only.
 *
 * Class names stay literal (`dhi-*`, `dhi-ctxfill*`): the DOM code's checks
 * (`cls.contains("dhi-twrap")` etc.) and the CSS structural selectors must be
 * the same stable names — the reference build's CSS-module scoping would hash
 * them and break both, so this sheet is injected raw and DOM-checked per
 * document (./index.ts) instead.
 */
export const HOVER_CSS =
    ".dhi-bar{display:flex;gap:4px;flex:none;align-items:center}" +
    ".dhi-btn{cursor:pointer;width:22px;height:20px;color:#adb2b8;background:0 0;border:none;border-radius:4px;justify-content:center;align-items:center;padding:0;display:inline-flex}" +
    ".dhi-btn:hover{color:#f6f7f8;background:rgb(255 255 255 / 10%)}" +
    ".dhi-btn svg{width:13px;height:13px;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;fill:none}" +
    // Two COLUMNS of rows, auto-placed one metric per cell, so the tracks must
    // be equal (minmax(0,1fr) twice). `1fr auto` — a leftover from the single
    // label/value row model — left the label column absorbing every leftover
    // px while the value column only sized to max-content, so the left column
    // read visibly wider than the right for most metric sets.
    ".dhi-metrics{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px 12px;margin-top:8px;padding-top:8px;border-top:.5px solid rgb(255 255 255 / 12%);font-size:12px;line-height:16px;pointer-events:none;max-height:176px;overflow:hidden}" +
    ".dhi-k{color:#adb2b8;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    ".dhi-v{color:#cfd3d6;flex:none;padding-left:8px;text-align:right}" +
    ".dhi-mrow{min-width:0;justify-content:space-between;align-items:baseline;gap:6px;display:flex}" +
    ".dhi-mrow[data-hi-metric=\"createdAt\"]{grid-column:1 / -1}" +
    ".dhi-mrow[data-hi-metric=\"model\"]{grid-column:1 / -1}" +
    ".dhi-mrow[data-hi-metric=\"subagents\"]{grid-column:1 / -1}" +
    ".dhi-mrow-context{grid-column:1 / -1;min-width:0;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 10px}" +
    ".dhi-ctxbar{grid-column:1 / -1;height:4px;border-radius:2px;background:rgb(255 255 255 / 10%);overflow:hidden;margin-top:2px}" +
    ".dhi-ctxfill{height:4px;border-radius:2px;background:#3fb950}" +
    ".dhi-ctxfill-warn{background:#d29922}" +
    ".dhi-ctxfill-error{background:#f85149}" +
    ".dhi-twrap{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12px;line-height:16px}" +
    // The title line is located structurally (the first stock line) and marked
    // — never matched by its hash-prefixed `*_hoverTitle` class. The
    // two-attribute selector outweighs that class rule no matter the
    // stylesheet order.
    "[data-hi-session] [data-hi-title]{font-size:16px}" +
    ".dhi-lead{display:inline-flex;align-items:center;gap:6px;min-width:0;overflow:hidden}";
