/**
 * Browser half — the field components, in the reference card's shape.
 *
 * Every field is a two-row `.field`: a `.fieldRow` carries the title (flex-1)
 * + the control inline, and the `.fieldDesc` row carries the copy full-width
 * below. The Overridden badge + reset sit between the title and the control.
 * The toggle is the shell's `Switch` primitive inside its `.toggleLabel`
 * wrapper (flex:none, the reference's rule) when resolvable — the row falls
 * back to a plain checkbox only if the primitive is absent.
 */
import { jsxs, jsx } from "react/jsx-runtime";
import { CARD_CSS } from "../styles/card.js";
import * as primitives from "@deepseek-ai/dsh-client-ui-primitives";

const Switch = primitives && primitives.Switch;

/** One boolean field: title + switch in the row, optional hint below. */
export function ToggleField(props: {
    id: string;
    label: string;
    /** Full-width copy under the row — the active hint. Omitted for the metric
     *  rows, which carry only their title. */
    desc?: string;
    field: { raw?: unknown; overridden?: boolean } | undefined;
    writable: boolean;
    t: (key: string) => string;
    onToggle: (checked: boolean) => void;
    onReset: () => void;
}): any {
    const field = props.field;
    const checked = !!(field && field.raw === true);
    return jsxs("div", {
        className: CARD_CSS.field,
        children: [
            jsxs("div", {
                className: CARD_CSS.fieldRow,
                children: [
                    // The title stays a clickable span (PLAN §17): clicking it
                    // toggles, the badge/reset ride outside its click area.
                    jsx("span", {
                        id: props.id,
                        className: CARD_CSS.fieldTitle,
                        onClick: function () {
                            if (props.writable) props.onToggle(!checked);
                        },
                        children: props.label
                    }),
                    field && field.overridden
                        ? jsxs("span", {
                            className: CARD_CSS.badges,
                            children: [
                                jsx("span", { className: CARD_CSS.badge, children: props.t("overridden") }),
                                jsx("button", {
                                    type: "button",
                                    className: CARD_CSS.reset,
                                    disabled: !props.writable,
                                    onClick: function () {
                                        props.onReset();
                                    },
                                    children: props.t("reset")
                                })
                            ]
                        })
                        : null,
                    jsx("span", {
                        className: CARD_CSS.toggleLabel,
                        children: Switch
                            ? jsx(Switch, {
                                checked: checked,
                                label: props.label,
                                disabled: !props.writable,
                                onChange: function (next: boolean) {
                                    props.onToggle(next);
                                }
                            })
                            : jsx("input", {
                                type: "checkbox",
                                checked: checked,
                                disabled: !props.writable,
                                "aria-label": props.label,
                                onChange: function (event: any) {
                                    props.onToggle(event.target.checked);
                                }
                            })
                    })
                ]
            }),
            props.desc ? jsx("div", { className: CARD_CSS.fieldDesc, children: props.desc }) : null
        ]
    });
}

/** The refresh-interval field: title + inline numeric input, hint (or the
 * invalid message) full-width below. */
export function RefreshField(props: {
    id: string;
    label: string;
    hint: string;
    invalidText: string;
    field: { raw?: unknown; overridden?: boolean; invalid?: boolean } | undefined;
    writable: boolean;
    t: (key: string) => string;
    onEdit: (text: string) => void;
    onCommit: () => void;
    onReset: () => void;
}): any {
    const field = props.field;
    const invalid = !!(field && field.invalid);
    return jsxs("div", {
        className: CARD_CSS.field,
        children: [
            jsxs("div", {
                className: CARD_CSS.fieldRow,
                children: [
                    jsx("label", { className: CARD_CSS.fieldTitle, htmlFor: props.id, children: props.label }),
                    field && field.overridden
                        ? jsxs("span", {
                            className: CARD_CSS.badges,
                            children: [
                                jsx("span", { className: CARD_CSS.badge, children: props.t("overridden") }),
                                jsx("button", {
                                    type: "button",
                                    className: CARD_CSS.reset,
                                    disabled: !props.writable,
                                    onClick: function () {
                                        props.onReset();
                                    },
                                    children: props.t("reset")
                                })
                            ]
                        })
                        : null,
                    jsx("input", {
                        id: props.id,
                        className: invalid ? CARD_CSS.input + " " + CARD_CSS.inputInvalid : CARD_CSS.input,
                        type: "text",
                        inputMode: "numeric",
                        value: field && field.raw !== void 0 ? String(field.raw) : "",
                        disabled: !props.writable,
                        onChange: function (event: any) {
                            props.onEdit(event.target.value);
                        },
                        onBlur: function () {
                            props.onCommit();
                        }
                    })
                ]
            }),
            jsx("div", {
                className: invalid ? CARD_CSS.fieldDesc + " " + CARD_CSS.invalid : CARD_CSS.fieldDesc,
                children: invalid ? props.invalidText : props.hint
            })
        ]
    });
}
