/**
 * Browser half — the copy-button icons.
 *
 * Inline SVG strings (the shell offers no id/path primitives to borrow). The
 * keys are the two copy targets the card offers (`id`, `path`); `done` is the
 * feedback glyph swapped in after a successful copy.
 */
export const ICONS: Record<string, string> = {
    id: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>',
    path: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>',
    done: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>'
};
