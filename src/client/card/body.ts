/**
 * Browser half — the configuration body, as the card's one block.
 *
 * The card machinery (`mountSettingsCard`, see ../index.ts) owns the slot on
 * the bundle's own page and the controller; what is declared here is what that
 * page renders. The page owns the container and its identity line — the crumb,
 * the artwork, the title and description, and the section the body sits in —
 * so what is rendered here is the configuration itself: no card shell, no
 * collapsed header, and nothing duplicated from what the page already states.
 *
 * The body is TWO CATALOG blocks, the shape the reference card
 * (`dsh-chrome-mcp`) composes configuration from, with the `.field` /
 * `.fieldRow` / `.fieldDesc` structure inside each: the first carries the
 * `showModelProvider` composer model-selector toggle as a two-row field (title
 * + switch inline, hint below), the second groups the metric toggles in a
 * TWO-COLUMN grid filled column-major (DOM order stays METRICS order) above
 * the refresh-interval field (title + inline input, hint below).
 *
 * No master switch rides here: the Plugins page's own row already answers
 * whether this plugin runs at all, so a second on/off here would only disagree
 * with it (docs/PLAN.md §40).
 *
 * {@link bindBody} is the block's `bind`: it projects the card snapshot into one
 * view per field (`raw` / `overridden` / `invalid`) and composes the four write
 * doors over the shared controller. The refreshMs draft text rides the
 * controller's own draft (`stage`): nothing reaches the host until it parses
 * clean on commit.
 */
import { jsx, jsxs } from "react/jsx-runtime";
import * as react from "react";
import { RefreshField, ToggleField } from "./field-row.js";
import { CARD_FIELDS, fieldSpec, parseRefreshMs } from "./fields.js";
import { CARD_CSS } from "../styles/card.js";
import { METRICS } from "../metrics.js";

/** One field as the body draws it. */
export interface BodyField {
    raw: any;
    overridden: boolean;
    invalid: boolean;
}

/** What the block renders from: the projected fields plus the write doors. */
export interface HoverInformationBodyProps {
    t: (key: string) => string;
    writable: boolean;
    fields: Record<string, BodyField>;
    toggle: (field: string, checked: boolean) => unknown;
    resetField: (field: string) => unknown;
    editRefresh: (text: string) => void;
    commitRefresh: () => unknown;
}

/** The card snapshot fields the projection reads (see dsh-ancesters `CardSnapshot`). */
interface SnapshotView {
    values: Record<string, unknown>;
    overridden?: readonly string[];
    writable: boolean;
}

/** The controller doors the bind composes (see dsh-ancesters `CardController`). */
interface ControllerView {
    value(field: string): unknown;
    servedValue(field: string): unknown;
    stage(field: string, value: unknown): void;
    discard(): void;
    writeField(field: string, value: unknown): Promise<boolean>;
    resetField(field: string): Promise<boolean>;
}

/** Project one field off the snapshot: a staged refreshMs draft is a string. */
function projectField(field: string, snapshot: SnapshotView): BodyField {
    const spec = fieldSpec(field);
    const value = snapshot.values[field];
    const overridden = Array.isArray(snapshot.overridden) && snapshot.overridden.indexOf(field) >= 0;
    if (spec !== null && spec.kind === "int") {
        if (typeof value === "string") {
            return { raw: value, overridden, invalid: value.trim() !== "" && parseRefreshMs(value, spec) === null };
        }
        return { raw: typeof value === "number" ? String(value) : "", overridden, invalid: false };
    }
    return { raw: value === true, overridden, invalid: false };
}

/** Commit the staged refreshMs when it parses clean; returns whether it landed. */
async function commitRefresh(controller: ControllerView): Promise<boolean> {
    const draft = controller.value("refreshMs");
    if (typeof draft !== "string") return false;
    const parsed = parseRefreshMs(draft, fieldSpec("refreshMs"));
    if (parsed === null) return false;
    if (controller.servedValue("refreshMs") === parsed) {
        controller.discard();
        return true;
    }
    const landed = await controller.writeField("refreshMs", parsed);
    // Only the refreshMs text is ever staged, so dropping every draft drops it.
    if (landed) controller.discard();
    return landed;
}

/**
 * The block's `bind`: the projected fields and the doors, from the current
 * snapshot and the shared controller.
 */
export function bindBody(snapshot: SnapshotView, controller: ControllerView): Omit<HoverInformationBodyProps, "t"> {
    const fields: Record<string, BodyField> = {};
    for (let i = 0; i < CARD_FIELDS.length; i++) fields[CARD_FIELDS[i].field] = projectField(CARD_FIELDS[i].field, snapshot);
    return {
        writable: snapshot.writable === true,
        fields,
        toggle: (field, checked) => controller.writeField(field, checked === true),
        resetField: (field) => controller.resetField(field),
        editRefresh: (text) => controller.stage("refreshMs", String(text)),
        commitRefresh: () => commitRefresh(controller)
    };
}

/** The configuration body — two catalog blocks, the page's container already
 * around them. A component of its own (the card machinery calls blocks as plain
 * functions), so its one hook keeps a stable order across renders. */
function HoverInformationBody(props: HoverInformationBodyProps): any {
    const t = props.t;
    const fields = props.fields;
    const writable = props.writable;
    const idSeed = react.useId();
    return jsxs("div", {
        className: CARD_CSS.body,
        children: [
            writable
                ? null
                : jsx("p", { className: CARD_CSS.readOnly, role: "status", children: t("readOnly") }),
            // Catalog 1 — the composer model-selector provider toggle as its
            // own catalog block (the reference's toggle block: field row +
            // description row).
            jsx("div", {
                className: CARD_CSS.catalog,
                children: jsx(ToggleField, {
                    id: idSeed + "-modelProvider",
                    label: t("modelProvider"),
                    desc: t("modelProviderHint"),
                    field: fields.showModelProvider,
                    writable: writable,
                    t: t,
                    onToggle: function (checked: boolean) {
                        props.toggle("showModelProvider", checked);
                    },
                    onReset: function () {
                        props.resetField("showModelProvider");
                    }
                })
            }),
            // Catalog 2 — the metric toggles laid in two columns, filled
            // column-major (the row count is ceil(n/2), set inline so DOM
            // order stays METRICS order while the columns read
            // top-to-bottom), above the refresh-interval field.
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
                                    writable: writable,
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
                        writable: writable,
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
    });
}

/** The declared block: renders the body as its own component. */
export function HoverInformationBlock(props: HoverInformationBodyProps): any {
    return jsx(HoverInformationBody, props);
}
