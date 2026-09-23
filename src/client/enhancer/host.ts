/**
 * Browser half — host-service access for the enhancer.
 *
 * Everything the enhancer reads lives behind `ctx`: the browser `sessions`
 * store (identity + the `hoverInfo` projection hint), the `connection` (the
 * RPC envelope the stats/file fetches ride), and `locale` (copy). Every path
 * is fail-open: a missing store, locale or transport returns nothing rather
 * than throwing into the DOM walk.
 */
import { LOCALE_NAMESPACE, WORKSPACE_NAMESPACE } from "../plugin-meta.js";

/** The live `sessions.list` snapshot, or null when the store is absent. */
export function sessionsSnapshot(env: { ctx: any }): any {
    try {
        var sessions = env.ctx.get("sessions");
        if (!sessions || !sessions.list || typeof sessions.list.getSnapshot !== "function") return null;
        var snapshot = sessions.list.getSnapshot();
        if (!snapshot || typeof snapshot !== "object" || !snapshot.byId) return null;
        return snapshot;
    } catch (error) {
        return null;
    }
}

/**
 * The `hoverInfo` projection value the browser session store already carries
 * for one session (`byId[id].projectionValues`) — the same per-row projection
 * block every other plugin reads (`agentPreset` reads it the same way), so
 * this is zero extra IO. It is a HINT: as fresh as that session's last durable
 * checkpoint, and simply absent for sessions that have not checkpointed since
 * the `hoverInfo` unit registered.
 * @returns the cached wire view, or null when there is none.
 */
export function storeHint(env: { ctx: any }, sessionId: string): any {
    var snap = sessionsSnapshot(env);
    var record = snap && snap.byId ? snap.byId[sessionId] : void 0;
    var values = record && record.projectionValues;
    var view = values ? values.hoverInfo : void 0;
    return view && typeof view === "object" ? view : null;
}

/** A locale string; the key itself when translation is unavailable. */
export function translate(env: { ctx: any }, ns: string, key: string, params?: any): string {
    try {
        return String(env.ctx.locale.translate(ns, key, params));
    } catch (error) {
        return key;
    }
}

/** This plugin's own dictionary string. */
export function translateSelf(env: { ctx: any }, key: string): string {
    return translate(env, LOCALE_NAMESPACE, key);
}

/** The stock workspace-browser relative-time labels. */
export function translateWorkspace(env: { ctx: any }, key: string, params?: any): string {
    return translate(env, WORKSPACE_NAMESPACE, key, params);
}

/**
 * Typert call through the browser `connection` RPC
 * (`dsh-client-connection` client half): POST /api +
 * `{type:"client-request", rpcId, method, payload:{args}}`,
 * result `{ok:true,value}` / `{ok:false,error}`. Any
 * transport error or `ok:false` resolves null — fail-open.
 */
export function callHostRpc(env: { ctx: any }, method: string, args: any): Promise<any> {
    var connection = null;
    try {
        connection = env.ctx.get("connection");
    } catch (error) {
        connection = null;
    }
    var rpc = connection && connection.rpc;
    if (!rpc || typeof rpc.call !== "function") return Promise.resolve(null);
    var call = null;
    try {
        call = rpc.call("/api", method, { args: args === void 0 ? {} : args });
    } catch (error) {
        return Promise.resolve(null);
    }
    return Promise.resolve(call).then(
        function (result: any) {
            if (!result || result.ok !== true || result.value === void 0) return null;
            return result.value;
        },
        function () {
            return null;
        }
    );
}
