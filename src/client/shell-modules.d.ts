/**
 * Structural views of the modules the shell seeds into its module table.
 *
 * Only the two `@deepseek-ai/dsh-client-*` ids need describing: they resolve
 * inside the running GUI's module table and appear in no local `node_modules`
 * tree (no `@types/*` for them exists), so they are described here — the same
 * structural-view idiom the host half uses for services it does not depend
 * on — rather than imported. `react`, `react/jsx-runtime` and
 * `react-dom/client` are the baseline modules that DO have local types
 * (`react` + `react-dom` and their `@types/*` are devDependencies, kept
 * external by `scripts/build-client.mjs`), so those imports resolve normally
 * through `node_modules/@types`.
 *
 * Keep the shapes as narrow as what this half actually calls; widening them
 * to match upstream's real surface is a drift risk the tests cannot catch.
 */
declare module "@deepseek-ai/dsh-client-store" {
    /** A subscriber store: `getSnapshot` is stable identity, `set` notifies. */
    export interface SnapshotStore<T> {
        subscribe(listener: () => void): () => void;
        getSnapshot(): T;
        set(next: T): void;
    }

    /** Create a snapshot store seeded with `initial`. */
    export function createSnapshotStore<T>(initial: T): SnapshotStore<T>;
}

declare module "@deepseek-ai/dsh-client-ui-primitives" {
    /** The stock settings toggle (self-styled by the shell CSS — never
     *  reference its hashed class names). Resolved structurally. */
    export const Switch: (props: {
        checked: boolean;
        label: string;
        disabled?: boolean;
        onChange: (next: boolean) => void;
    }) => any;
}
