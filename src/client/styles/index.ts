/**
 * Stylesheet strings carry no class-name map: every DOM reference in the
 * enhancer is structural (`cls.contains("dhi-twrap")`), and every class is
 * literal on purpose (see ./hover-card.ts). Re-written without the map to keep
 * the file a pure sheet export.
 */
import { CARD_CSS_TAG, HOVER_CSS_TAG } from "../constants.js";
import { PLUGIN_ID } from "../plugin-meta.js";
import { CARD_CSS_TEXT } from "./card.js";
import { HOVER_CSS } from "./hover-card.js";

/** Append the hover-card overlay sheet, returning the removal disposer. */
export function injectHoverCss(doc: any): () => void {
    if (doc.querySelector('style[data-plugin-css="' + HOVER_CSS_TAG + '"]') !== null) return noop;
    const tag = doc.createElement("style");
    tag.dataset.plugin = PLUGIN_ID;
    tag.dataset.pluginCss = HOVER_CSS_TAG;
    tag.textContent = HOVER_CSS;
    doc.head.appendChild(tag);
    return function () {
        tag.remove();
    };
}

/**
 * Append the settings-card sheet once per document. DOM-checked (like the
 * overlay), never a module-level flag — a module flag breaks a second
 * document's styles.
 */
export function injectCardCss(doc: any): void {
    if (doc.querySelector('style[data-plugin-css="' + CARD_CSS_TAG + '"]') !== null) return;
    const tag = doc.createElement("style");
    tag.dataset.plugin = PLUGIN_ID;
    tag.dataset.pluginCss = CARD_CSS_TAG;
    tag.textContent = CARD_CSS_TEXT;
    doc.head.appendChild(tag);
}

function noop(): void {}
