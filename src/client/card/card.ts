/**
 * Browser half — the settings card component.
 *
 * Collapsible (closed by default); renders nothing until the namespace is
 * served. The body is FIVE CATALOG blocks — the shape the reference card
 * (`dsh-chrome-mcp`) composes its Settings UI from, with the `.field` /
 * `.fieldRow` / `.fieldDesc` structure inside each: the first block is the
 * master `active` switch as its own two-row field (title + switch inline,
 * hint below), the second carries the `showPreviewTools` sidebar-preview
 * toggle as its own two-row field, the third carries the `showModelProvider`
 * composer model-selector toggle in the same shape, the fourth carries the
 * `showJobKill` background-job kill toggle in the same shape, and the fifth
 * groups the metric toggles in a TWO-COLUMN grid filled column-major (DOM
 * order stays METRICS order) above the refresh-interval field (title + inline
 * input, hint below).
 */
import { jsx, jsxs } from "react/jsx-runtime";
import * as react from "react";
import { RefreshField, ToggleField } from "./field-row.js";
import { CHEVRON_PATH } from "./icons.js";
import { CARD_CSS } from "../styles/card.js";
import { METRICS } from "../metrics.js";

/** Props the slot hands down: `hooks.hoverInformationCard` + the actions. */
interface CardProps {
    t: (key: string) => string;
    useHoverInformationCard: (select: (snapshot: any) => any) => any;
    toggle: (field: string, checked: boolean) => void;
    resetField: (field: string) => void;
    editRefresh: (text: string) => void;
    commitRefresh: () => void;
}

/** The card component. */
export function HoverInformationCard(props: CardProps): any {
    const t = props.t;
    const state = props.useHoverInformationCard((snapshot: any) => snapshot);
    const openState = react.useState(false);
    const open = openState[0];
    const setOpen = openState[1];
    const bodyId = react.useId();
    const idSeed = react.useId();
    if (!state.available) return null;
    const disabled = !state.writable;
    const fields = state.fields;
    return jsxs("li", {
        className: CARD_CSS.card + (open ? " " + CARD_CSS.cardOpen : ""),
        children: [
            jsxs("button", {
                type: "button",
                className: CARD_CSS.header,
                "aria-expanded": open,
                "aria-label": t(open ? "collapse" : "expand") + ": " + t("title"),
                "aria-controls": bodyId,
                onClick: function () {
                    setOpen(!open);
                },
                children: [
                    jsxs("span", {
                        className: CARD_CSS.headText,
                        children: [
                            jsx("span", { className: CARD_CSS.name, children: t("title") }),
                            jsx("span", { className: CARD_CSS.desc, children: t("description") })
                        ]
                    }),
                    jsx("svg", {
                        width: 14,
                        height: 14,
                        className: CARD_CSS.chevron + (open ? " " + CARD_CSS.chevronOpen : ""),
                        viewBox: "0 0 14 14",
                        fill: "none",
                        xmlns: "http://www.w3.org/2000/svg",
                        children: jsx("path", { d: CHEVRON_PATH, fill: "currentColor" })
                    })
                ]
            }),
            open
                ? jsxs("div", {
                        id: bodyId,
                        className: CARD_CSS.body,
                        children: [
                            state.writable
                                ? null
                                : jsx("p", { className: CARD_CSS.readOnly, role: "status", children: t("readOnly") }),
                            // Catalog 1 — the master switch as its own catalog
                            // block (the reference's toggle block: field row +
                            // description row).
                            jsx("div", {
                                className: CARD_CSS.catalog,
                                children: jsx(ToggleField, {
                                    id: idSeed + "-active",
                                    label: t("active"),
                                    desc: t("activeHint"),
                                    field: fields.active,
                                    writable: !disabled,
                                    t: t,
                                    onToggle: function (checked: boolean) {
                                        props.toggle("active", checked);
                                    },
                                    onReset: function () {
                                        props.resetField("active");
                                    }
                                })
                            }),
                            // Catalog 2 — the sidebar-preview tools toggle as
                            // its own catalog block (same two-row field shape
                            // as the master switch).
                            jsx("div", {
                                className: CARD_CSS.catalog,
                                children: jsx(ToggleField, {
                                    id: idSeed + "-previewTools",
                                    label: t("previewTools"),
                                    desc: t("previewToolsHint"),
                                    field: fields.showPreviewTools,
                                    writable: !disabled,
                                    t: t,
                                    onToggle: function (checked: boolean) {
                                        props.toggle("showPreviewTools", checked);
                                    },
                                    onReset: function () {
                                        props.resetField("showPreviewTools");
                                    }
                                })
                            }),
                            // Catalog 3 — the composer model-selector provider
                            // toggle as its own catalog block (same two-row
                            // field shape as the master switch).
                            jsx("div", {
                                className: CARD_CSS.catalog,
                                children: jsx(ToggleField, {
                                    id: idSeed + "-modelProvider",
                                    label: t("modelProvider"),
                                    desc: t("modelProviderHint"),
                                    field: fields.showModelProvider,
                                    writable: !disabled,
                                    t: t,
                                    onToggle: function (checked: boolean) {
                                        props.toggle("showModelProvider", checked);
                                    },
                                    onReset: function () {
                                        props.resetField("showModelProvider");
                                    }
                                })
                            }),
                            // Catalog 4 — the background-job kill toggle as its
                            // own catalog block (same two-row field shape as
                            // the master switch).
                            jsx("div", {
                                className: CARD_CSS.catalog,
                                children: jsx(ToggleField, {
                                    id: idSeed + "-jobKill",
                                    label: t("jobKill"),
                                    desc: t("jobKillHint"),
                                    field: fields.showJobKill,
                                    writable: !disabled,
                                    t: t,
                                    onToggle: function (checked: boolean) {
                                        props.toggle("showJobKill", checked);
                                    },
                                    onReset: function () {
                                        props.resetField("showJobKill");
                                    }
                                })
                            }),
                            // Catalog 5 — the metric toggles laid in two
                            // columns, filled column-major (the row count is
                            // ceil(n/2), set inline so DOM order stays METRICS
                            // order while the columns read top-to-bottom),
                            // above the refresh-interval field.
                            jsxs("div", {
                                className: CARD_CSS.catalog,
                                children: [
                                    jsx("div", {
                                        className: CARD_CSS.grid,
                                        style: { gridTemplateRows: "repeat(" + Math.ceil(METRICS.length / 2) + ", auto)" },
                                        children: METRICS.map(function (row) {
                                            return jsx(
                                                ToggleField,
                                                {
                                                    id: idSeed + "-" + row.field,
                                                    label: t(row.labelKey),
                                                    field: fields[row.field],
                                                    writable: !disabled,
                                                    t: t,
                                                    onToggle: function (checked: boolean) {
                                                        props.toggle(row.field, checked);
                                                    },
                                                    onReset: function () {
                                                        props.resetField(row.field);
                                                    }
                                                },
                                                row.field
                                            );
                                        })
                                    }),
                                    jsx(RefreshField, {
                                        id: idSeed + "-refresh",
                                        label: t("refresh"),
                                        hint: t("refreshHint"),
                                        invalidText: t("refreshInvalid"),
                                        field: fields.refreshMs,
                                        writable: !disabled,
                                        t: t,
                                        onEdit: function (text: string) {
                                            props.editRefresh(text);
                                        },
                                        onCommit: function () {
                                            props.commitRefresh();
                                        },
                                        onReset: function () {
                                            props.resetField("refreshMs");
                                        }
                                    })
                                ]
                            })
                        ]
                    })
                : null
        ]
    });
}
