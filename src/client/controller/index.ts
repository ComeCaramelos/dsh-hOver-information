/**
 * Browser half — the settings-card controller.
 *
 * Publishes `{ available, writable, fields }` from the bound settings scope
 * (the whole data source) plus local drafts for the refreshMs int field.
 * Booleans write straight through; invalid int drafts stay staged — nothing
 * reaches the host until `commitRefresh` parses clean.
 *
 * The store is the shell's snapshot store: the card view subscribes through the
 * slot's `inject` and never reads `scope` directly, so one `set` re-renders
 * every mounted card.
 */
import { createSnapshotStore } from "@deepseek-ai/dsh-client-store";
import { CARD_FIELDS, fieldSpec, parseRefreshMs } from "./fields.js";

/** The scope's live snapshot, read here without naming its upstream type. */
type ScopeSnapshot = {
    status?: string;
    value?: Record<string, any> | undefined;
    writable?: boolean;
    user?: Record<string, any> | undefined;
};
type BoundScope = {
    getSnapshot(): ScopeSnapshot;
    set(field: string, value: any): Promise<unknown>;
    unset(field: string): Promise<unknown>;
    subscribe(listener: () => void): (() => void) | undefined;
};

export class HoverInformationCardController {
    /** The bound settings scope (`settingsScope`; null until it resolves). */
    scope: BoundScope;
    /** Staged int drafts keyed by field; discarded on every live publish. */
    staged: Map<string, { text: string }>;
    /** Set by `dispose()` so a late store notification never re-publishes. */
    disposed: boolean;
    /** Live snapshot store the card's `fields` view is produced from. */
    store: any;
    /** Scope subscription disposer. */
    unsubscribe: (() => void) | undefined;

    constructor(scope: BoundScope) {
        this.scope = scope;
        this.staged = new Map();
        this.disposed = false;
        this.store = createSnapshotStore(this.projection());
        this.unsubscribe = scope.subscribe(() => {
            if (!this.disposed) this.publish();
        });
    }

    storedIn(snapshot: ScopeSnapshot, field: string): boolean {
        return snapshot.user != null && Object.prototype.hasOwnProperty.call(snapshot.user, field);
    }

    fieldProjection(field: string, snapshot: ScopeSnapshot): { raw: any; overridden: boolean; invalid: boolean } {
        const spec = fieldSpec(field);
        const value = snapshot.value != null ? (snapshot.value as Record<string, any>)[field] : void 0;
        const staged = this.staged.get(field);
        let raw: any;
        let invalid = false;
        if (spec !== null && spec.kind === "int") {
            if (staged !== void 0) {
                raw = staged.text;
                invalid = staged.text.trim() !== "" && parseRefreshMs(staged.text, spec) === null;
            } else {
                raw = typeof value === "number" ? String(value) : "";
            }
        } else {
            raw = value === true;
        }
        return { raw, overridden: this.storedIn(snapshot, field), invalid };
    }

    projection(): { available: boolean; writable: boolean; fields: Record<string, any> } {
        const snapshot = this.scope.getSnapshot();
        const ready = snapshot.status === "ready" && snapshot.value !== void 0;
        const fields: Record<string, any> = {};
        for (let i = 0; i < CARD_FIELD_NAMES.length; i++) {
            const field = CARD_FIELD_NAMES[i];
            fields[field] = this.fieldProjection(field, snapshot);
        }
        return { available: ready, writable: snapshot.writable === true, fields };
    }

    publish(): void {
        if (!this.disposed) this.store.set(this.projection());
    }

    /** Write one boolean straight to the user layer. */
    toggle(field: string, checked: boolean): Promise<boolean> {
        const spec = fieldSpec(field);
        if (spec === null || spec.kind !== "bool") return Promise.resolve(false);
        return this.scope.set(field, !!checked).then(
            () => {
                this.publish();
                return true;
            },
            () => {
                this.publish();
                return false;
            }
        );
    }

    /** Stage the refreshMs draft text. */
    editRefresh(text: string): void {
        this.staged.set("refreshMs", { text: String(text) });
        this.publish();
    }

    /** Commit the staged refreshMs when valid; returns whether it landed. */
    commitRefresh(): Promise<boolean> {
        const staged = this.staged.get("refreshMs");
        if (staged === void 0) return Promise.resolve(false);
        const parsed = parseRefreshMs(staged.text, fieldSpec("refreshMs"));
        if (parsed === null) {
            this.publish();
            return Promise.resolve(false);
        }
        const current = this.scope.getSnapshot().value;
        if (current !== void 0 && (current as Record<string, any>).refreshMs === parsed) {
            this.staged.delete("refreshMs");
            this.publish();
            return Promise.resolve(true);
        }
        return this.scope.set("refreshMs", parsed).then(
            () => {
                const snapshot = this.scope.getSnapshot();
                const landed = snapshot.user != null && (snapshot.user as Record<string, any>).refreshMs === parsed;
                if (landed) this.staged.delete("refreshMs");
                this.publish();
                return landed;
            },
            () => false
        );
    }

    /** Clear one field's user-layer override. */
    resetField(field: string): Promise<boolean> {
        return this.scope.unset(field).then(
            () => {
                this.staged.delete(field);
                this.publish();
                return true;
            },
            () => false
        );
    }

    /** What the card slot receives: the store plus the action callbacks. */
    inject(): Record<string, any> {
        const self = this;
        return {
            hooks: { hoverInformationCard: this.store },
            toggle: function (field: string, checked: boolean) {
                return self.toggle(field, checked);
            },
            editRefresh: function (text: string) {
                self.editRefresh(text);
            },
            commitRefresh: function () {
                return self.commitRefresh();
            },
            resetField: function (field: string) {
                return self.resetField(field);
            }
        };
    }

    dispose(): void {
        this.disposed = true;
        if (this.unsubscribe) this.unsubscribe();
    }
}

/** Field iteration order for the projection (flattened from CARD_FIELDS). */
const CARD_FIELD_NAMES: string[] = [];
for (let i = 0; i < CARD_FIELDS.length; i++) CARD_FIELD_NAMES.push(CARD_FIELDS[i].field);
