/**
 * @comecaramelos/dsh-hover-information — `hoverInfo` Typert remote.
 *
 * Exposes two read-only RPC methods to the browser over the generic
 * HTTP endpoint surface (`POST /api/hoverInfo/<method>`):
 *
 * - `sessions()` — the live sidebar list: `{ id, title, updatedAt, running }`.
 *   The browser uses this to match a hover card back to a session when the
 *   React-fiber fast-path is unavailable (docs/PLAN.md §6.2).
 * - `stats(sessionId)` — the full metric view for one live session: the
 *   `hoverInfo` projection wire plus live subagent-running counts, resolved
 *   from sessions whose `header.parentSession` points at this session.
 *
 * rc.2 facts this file depends on (verified against the installed harness;
 * docs/PLAN.md §8.1 spike):
 * - `sessions.list()` returns live `Session` instances with `id` and a
 *   `header` of `{ id, version, createdAt, cwd?, parentSession?, origin?, … }`
 *   — there is NO `header.title`/`header.updatedAt`/`header.model` field.
 * - Title comes from the `title` session projection (null until generated).
 * - Activity time is `max(header.createdAt, sessionListMetadata.lastPromptAt)`
 *   (the same formula `dsh-api-session-controller` uses).
 * - `running` comes from the live agent: `ctx.agents.get(id)?.status`.
 * - `subagent/start|end` are event-BUS emits, not log events (the durable
 *   per-child fact is `subagent/catalog`, folded into `subagentsSpawned`);
 *   live running counts therefore ride the parentSession lineage above.
 *
 * Remote registration uses the documented manual descriptor rather than
 * decorators: plain-JS class decorators are not available without a build
 * step, and the gateway reads the prototype own-property
 * `"@deepseek-ai/dsh-typert-protocol/remote-methods"` (`remoteMethods()`).
 */
import { RemoteError, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";

/** Prototype descriptor key the protocol reads. */
const REMOTE_METHOD_DESCRIPTOR = "@deepseek-ai/dsh-typert-protocol/remote-methods";

/** Live agent face that resolves a live session's running state. */
function agentsOf(ctx) {
	try {
		return ctx.get("agents");
	} catch {
		return void 0;
	}
}

/** Sessions service face, or undefined when the host does not mount one. */
function sessionsOf(ctx) {
	try {
		return ctx.get("sessions");
	} catch {
		return void 0;
	}
}

/**
 * Session-projection registry face, or undefined when absent. Resolved
 * through `ctx.get` (not the `ctx.sessionProjections` property): property
 * access on a plain-`new`ed Service fiber throws
 * `cannot get property "sessionProjections" without inject`, while
 * `ctx.get` resolves any composed service.
 */
function projectionsOf(ctx) {
	try {
		return ctx.get("sessionProjections");
	} catch {
		return void 0;
	}
}

export class HoverInfoRemote extends TypertRemoteService {
	static inject = ["sessions", "sessionProjections"];

	constructor(ctx) {
		super(ctx, "hoverInfoRemote", { namespace: "hoverInfo" });
	}

	/**
	 * Live session rows for the client's card matching.
	 * @returns `{ id, title, updatedAt, running, cwd, createdAt }` per live session.
	 */
	sessions() {
		const sessions = sessionsOf(this.ctx);
		if (!sessions) return [];
		const agents = agentsOf(this.ctx);
		const projections = projectionsOf(this.ctx);
		const rows = [];
		for (const session of sessions.list()) {
			let title = null;
			let lastPromptAt = null;
			try {
				const snap = projections?.snapshot(session, ["title", "sessionListMetadata"]);
				title = snap?.values.title ?? null;
				lastPromptAt = snap?.values.sessionListMetadata?.lastPromptAt ?? null;
			} catch {
				// A projection not being registered is not fatal here: the row
				// falls back to createdAt and a null title.
			}
			rows.push({
				id: String(session.id),
				title: typeof title === "string" ? title : null,
				updatedAt: Math.max(
					typeof session.header?.createdAt === "number" ? session.header.createdAt : 0,
					typeof lastPromptAt === "number" ? lastPromptAt : 0
				),
				running: agents?.get?.(String(session.id))?.status === "running",
				cwd: typeof session.header?.cwd === "string" ? session.header.cwd : null,
				createdAt: typeof session.header?.createdAt === "number" ? session.header.createdAt : null
			});
		}
		return rows;
	}

	/**
	 * Full metric view for one live session.
	 * @param sessionId - session id to read.
	 * @returns the `hoverInfo` wire view plus live running-subagent counts.
	 * @throws RemoteError `hoverInfo/session-not-found` when the session is
	 *   not loaded live (the browser treats this as "no data" and leaves the
	 *   stock card untouched — fail-open).
	 */
	stats(sessionId) {
		const id = String(sessionId);
		const sessions = sessionsOf(this.ctx);
		const session = sessions?.get?.(id);
		if (!session) throw new RemoteError("hoverInfo/session-not-found", `session ${id} is not loaded live`, {});
		let view;
		try {
			const projections = projectionsOf(this.ctx);
			const snap = projections?.snapshot(session, ["hoverInfo"]);
			view = snap?.values.hoverInfo;
		} catch {
			throw new RemoteError("hoverInfo/not-loaded", `hoverInfo projection unavailable for session ${id}`, {});
		}
		if (!view) throw new RemoteError("hoverInfo/not-loaded", `hoverInfo projection unavailable for session ${id}`, {});
		const agents = agentsOf(this.ctx);
		let running = 0;
		for (const child of sessions.list()) {
			if (child.id === id) continue;
			if (child.header?.origin !== "subagent" || child.header?.parentSession !== id) continue;
			if (agents?.get?.(String(child.id))?.status === "running") running += 1;
		}
		return { ...view, subagentsRunning: running };
	}
}

/**
 * Attach the manual `@Remote` markers the protocol reads off the prototype
 * (docs/PLAN.md §5.2 fallback; no decorator risk). Idempotent.
 */
Object.defineProperty(HoverInfoRemote.prototype, REMOTE_METHOD_DESCRIPTOR, {
	configurable: true,
	value: Object.freeze({
		version: 1,
		methods: Object.freeze([
			Object.freeze({ method: "sessions", invocation: Object.freeze({ kind: "direct" }) }),
			Object.freeze({ method: "stats", invocation: Object.freeze({ kind: "direct" }) })
		])
	})
});
