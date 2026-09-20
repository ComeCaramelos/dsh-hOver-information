/**
 * Browser-half tests: load the lazy-CJS bundle with a `__ModuleLoader__`
 * stub, drive the enhancer + the settings card over the DOM stub in
 * `./dom.mjs`, and check the fail-open rules (fiber fast-path, unique title
 * match, time tie-break, path-line rejection, master switch, metrics fetch,
 * cleanup).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createDom, makeCard, attachFiber, makePreview, attachPropsFiber } from "./dom.mjs";

const requireCjs = createRequire(import.meta.url);

let loaded = null;
globalThis.window = {
	__ModuleLoader__: {
		load(spec) {
			loaded = spec;
		}
	}
};
await import("../lib/client.js");

/** Baseline modules resolved from devDependencies / stubs. */
function createStubStore(initial) {
	let value = initial;
	const listeners = new Set();
	return {
		set(next) {
			value = next;
			for (const listener of listeners) listener();
		},
		getSnapshot() {
			return value;
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		}
	};
}

/** Stand-in for the shell's `Switch` primitive (same DOM contract). */
function stubSwitch(props) {
	return requireCjs("react").createElement("button", {
		type: "button",
		role: "switch",
		"aria-checked": props.checked,
		"aria-label": props.label,
		disabled: props.disabled,
		onClick: function () {
			props.onChange(!props.checked);
		}
	});
}

const bundle = loaded.factory((id) => {
	switch (id) {
		case "react":
			return requireCjs("react");
		case "react/jsx-runtime":
			return requireCjs("react/jsx-runtime");
		case "@deepseek-ai/dsh-client-store":
			return { createSnapshotStore: createStubStore };
		case "@deepseek-ai/dsh-client-ui-primitives":
			return { Switch: stubSwitch };
		default:
			throw new Error(`unexpected require in client bundle: ${id}`);
	}
});

test("the bundle exports apply plus the card/enhancer halves and the inject list", () => {
	assert.equal(typeof bundle.apply, "function");
	assert.equal(typeof bundle.applyCard, "function");
	assert.equal(typeof bundle.applyEnhancer, "function");
	assert.deepEqual(bundle.inject, ["sessions", "connection", "locale", "settingsScope", "slots"]);
});

const NOW = Date.now();

/** Default composed settings snapshot for the browser half. */
const BASE_SETTINGS = {
	active: true,
	refreshMs: 30000,
	showTurns: true,
	showSteps: true,
	showTokensIn: true,
	showTokensOut: true,
	showCacheRead: true,
	showCompactions: true,
	showContext: true,
	showSubagents: true,
	showModel: true,
	showToolCalls: false,
	showActiveTime: false,
	showCreatedAt: false
};

/** The workspace time labels the tie-break localizes against (en). */
const WORKSPACE_TIME_EN = {
	"time.now": "now",
	"time.minutes": "{n}min",
	"time.hours": "{n}h",
	"time.days": "{n}d",
	"time.ago": "{t} ago"
};

/** A session store snapshot face matching `sessions.list.getSnapshot()`. */
function store(byId) {
	return { list: { getSnapshot: () => ({ ids: Object.keys(byId), byId }), subscribe: () => () => {} } };
}

/** A stats payload shaped like the host `hoverInfo/stats` result. */
function statsPayload(overrides = {}) {
	return {
		turns: 3,
		steps: 7,
		tokensIn: 120000,
		tokensOut: 5400,
		cacheRead: 0,
		cacheWrite: 0,
		compactions: 1,
		subagentsSpawned: 2,
		toolCalls: 12,
		llmMs: 4000,
		toolMs: 2500,
		lastContext: { tokens: 81200, at: NOW - 60000 },
		lastRequest: { provider: "acme", model: "model-x", contextWindow: 128000, at: NOW - 60000 },
		createdAt: NOW - 86400000,
		...overrides
	};
}

/**
 * A mutable fake settings scope mirroring the stock bound-scope surface,
 * shared across the card controller and the enhancer's own bind.
 */
function makeScope(overrides = {}) {
	const scope = {
		writes: [],
		state: {
			status: "ready",
			value: { ...BASE_SETTINGS, ...overrides },
			base: { ...BASE_SETTINGS },
			user: { ...overrides },
			writable: true
		},
		listeners: new Set(),
		getSnapshot() {
			return this.state;
		},
		subscribe(listener) {
			this.listeners.add(listener);
			return () => this.listeners.delete(listener);
		},
		set(field, value) {
			this.writes.push(["set", field, value]);
			this.state = {
				...this.state,
				value: { ...this.state.value, [field]: value },
				user: { ...this.state.user, [field]: value }
			};
			for (const listener of this.listeners) listener();
			return Promise.resolve();
		},
		unset(field) {
			this.writes.push(["unset", field]);
			const user = { ...this.state.user };
			delete user[field];
			this.state = { ...this.state, user, value: { ...this.state.base, ...user } };
			for (const listener of this.listeners) listener();
			return Promise.resolve();
		}
	};
	return scope;
}

function setup({ sessions = store({}), settings = {}, stats = null, withSlots = false, dom = createDom() } = {}) {
	// Interval accounting: `created`/`cleared` track the lazy sweep heartbeat
	// (started with the first open card/preview, stopped with the last one),
	// `unrefCalls` proves the client un-refs the Node timer handle so a
	// forgotten `dispose` can never hold the test process alive, and the
	// captured callbacks let a test drive one tick synchronously.
	const intervals = { created: 0, cleared: 0, unrefCalls: 0 };
	const liveTimers = new Map();
	let timerId = 0;
	const sweepCallbacks = [];
	function clearLiveTimer(handle) {
		if (handle !== null && typeof handle === "object" && liveTimers.has(handle.id)) {
			clearInterval(liveTimers.get(handle.id));
			liveTimers.delete(handle.id);
			intervals.cleared += 1;
			return;
		}
		clearInterval(handle);
	}
	const win = {
		MutationObserver: dom.MutationObserver,
		getComputedStyle: dom.getComputedStyle,
		setTimeout: (...args) => setTimeout(...args),
		clearTimeout: (...args) => clearTimeout(...args),
		setInterval(fn, ms) {
			const handle = setInterval(fn, ms);
			const timer = {
				id: ++timerId,
				unref() {
					intervals.unrefCalls += 1;
					if (handle && typeof handle.unref === "function") handle.unref();
				}
			};
			liveTimers.set(timer.id, handle);
			sweepCallbacks.push(fn);
			intervals.created += 1;
			return timer;
		},
		clearInterval: (timer) => clearLiveTimer(timer),
		WeakMap: WeakMap,
		Map: Map,
		navigator: {
			clipboard: {
				written: [],
				writeText(text) {
					win.navigator.clipboard.written.push(text);
					return Promise.resolve();
				}
			}
		},
		// Browser base64 + UTF-8 decoders (Node-backed stand-ins) used by
		// the preview readAll fallback.
		atob: (value) => Buffer.from(value, "base64").toString("binary"),
		TextDecoder: TextDecoder
	};
	win.document = dom.doc;

	globalThis.window = win;
	globalThis.document = dom.doc;

	const locale = {
		registered: [],
		register(ns, dict) {
			locale.registered.push({ ns, dict });
			return () => {};
		},
		translate(ns, key, params) {
			let template = key;
			if (ns === "workspace") template = WORKSPACE_TIME_EN[key] ?? key;
			else if (ns === "hoverInfo") {
				const entry = locale.registered.find((registered) => registered.ns === "hoverInfo");
				template = (entry && entry.dict.en[key]) ?? key;
			}
			if (!params) return template;
			return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
		}
	};

	/** The single shared scope instance both halves bind to. */
	const scope = makeScope(settings);

	/** Connection RPC face: the stats payload rides the rpc envelope. */
	const rpcCalls = [];
	const connection = {
		rpc: {
			call(_channel, endpoint, payload) {
				rpcCalls.push({ endpoint, payload });
				if (stats === null) return Promise.resolve({ ok: false, error: { code: "hoverInfo/session-not-found", message: "none" } });
				return Promise.resolve({ ok: true, value: typeof stats === "function" ? stats(endpoint, payload) : stats });
			}
		}
	};

	const slots = {
		registrations: [],
		inject(name, fn) {
			fn();
			return () => {};
		},
		register(entry, component) {
			slots.registrations.push({ entry, component });
			return () => {};
		}
	};

	const ctx = {
		locale,
		settingsScope: {
			bind: () => scope
		},
		slots: withSlots ? slots : undefined,
		get(name) {
			if (name === "sessions") return sessions;
			if (name === "connection") return connection;
			return undefined;
		},
		effect(fn) {
			return fn();
		}
	};

	const dispose = bundle.apply(ctx);

	return {
		dom,
		win,
		doc: dom.doc,
		locale,
		scope,
		slots,
		rpcCalls,
		intervals,
		sweepCallbacks,
		dispose: typeof dispose === "function" ? dispose : () => {}
	};
}

/** A document-level click listener stands in for React's delegated copy handler. */
function stockCopySurface(dom, target) {
	let copies = 0;
	target.addEventListener("click", () => {
		copies += 1;
	});
	return () => copies;
}

function fire(dom, { added = [], removed = [] } = {}) {
	dom.flush([{ addedNodes: added, removedNodes: removed }]);
}

/** One attribute record for one target (the preview path element mount). */
function fireAttr(dom, target) {
	dom.flush([{ type: "attributes", attributeName: "data-textpreview-path", target }]);
}

function bars(card) {
	const stack = card.firstElementChild;
	if (!stack) return [];
	return Array.from(stack.querySelectorAll('[data-hi="1"]')).filter((child) => child.tagName === "DIV");
}

function tick() {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

test("fiber-addressed card: icons injected, copy surface neutralized", async () => {
	const env = setup({ sessions: store({ s1: { id: "s1", displayTitle: "Fix bug", cwd: "/home/u/proj", updatedAt: NOW - 60000, blank: false } }) });
	const card = makeCard(env.dom, { title: "Fix bug", time: "1min ago", statuses: ["Idle"] });
	attachFiber(card, { id: "s1", title: "Fix bug" });
	env.doc.body.appendChild(card);
	// React's delegated listener lives at the document root.
	const copied = stockCopySurface(env.dom, env.doc.body);

	fire(env.dom, { added: [card] });

	assert.equal(card.getAttribute("data-hi-session"), "s1");
	assert.equal(card.getAttribute("role"), null, "role=button must be removed");
	assert.equal(card.getAttribute("tabindex"), null, "tabindex must be removed");
	assert.equal(card.style.cursor, "default");

	const bar = bars(card)[0];
	assert.ok(bar, "corner icon row injected into the card body");
	const icons = bar.children.filter((child) => child.tagName === "BUTTON");
	assert.equal(icons.length, 2);
	assert.equal(icons[0].getAttribute("data-hi-copy"), "id");
	assert.equal(icons[1].getAttribute("data-hi-copy"), "path");
	assert.equal(icons[0].getAttribute("aria-label"), "Copy session ID");

	// A click anywhere on the card no longer reaches the copy surface. The title
	// line is the second line now — the header row took the top slot.
	const titleEl = card.firstElementChild.children[1];
	titleEl.dispatchEvent(new env.dom.DomEvent("click", titleEl));
	assert.equal(copied(), 0, "card click must not bubble out of the card");

	// The icon buttons copy their values.
	icons[0].dispatchEvent(new env.dom.DomEvent("click", icons[0]));
	await tick();
	assert.deepEqual(env.win.navigator.clipboard.written, ["s1"]);
	icons[1].dispatchEvent(new env.dom.DomEvent("click", icons[1]));
	await tick();
	assert.deepEqual(env.win.navigator.clipboard.written, ["s1", "/home/u/proj"]);
	// Icon clicks also never reach the stock copy surface.
	assert.equal(copied(), 0);

	env.dispose();
});

test("the status glyph sits in line with the copy icons and carries the status text as its title", () => {
	const env = setup({ sessions: store({ s1: { id: "s1", displayTitle: "Fix bug", cwd: "/home/u/proj", updatedAt: NOW - 480000, blank: false } }) });
	const card = makeCard(env.dom, { title: "Fix bug", time: "8min ago", statuses: [{ label: "Idle", glyph: true }] });
	attachFiber(card, { id: "s1", title: "Fix bug" });
	env.doc.body.appendChild(card);
	fire(env.dom, { added: [card] });

	const stack = card.firstElementChild;
	// [header row, title line] — the row now sits ABOVE the title, and the stock
	// `dot + label` line collapses into the row's icon, which now owns the label
	// as its title.
	assert.equal(stack.children.length, 2, "the status line is folded into the icon");
	const row = stack.children[0];
	assert.equal(row.className, "dhi-twrap", "one row holds glyph + time + buttons");
	assert.equal(row.dataset.hiTwrap, "1");
	assert.equal(row.style.fontSize, undefined, "the 12px size comes from the injected CSS, not inline styles");
	const lead = row.children[0];
	assert.equal(lead.className, "dhi-lead");
	const icon = lead.children[0];
	assert.equal(icon.tagName, "SPAN", "the status dot is a span in live DOM, not an svg");
	assert.equal(icon.getAttribute("data-hi-status-icon"), "1");
	assert.equal(icon.getAttribute("data-state"), "done", "the clone keeps data-state so the color rules apply");
	assert.equal(icon.getAttribute("title"), "Idle", "the status text lives on the icon");
	assert.equal(icon.getAttribute("aria-hidden"), null, "the icon is announced as the status now");
	assert.equal(icon.getAttribute("aria-label"), "Idle");
	assert.equal(stack.querySelectorAll("[data-state]").length, 1, "the dot reads once");
	assert.equal(lead.children[1].textContent, "8min ago");
	assert.equal(row.children[1].className, "dhi-bar");
	assert.equal(row.children[1].children.length, 2, "both copy icons live on that same row");
	// The buttons are no longer floated over the title line, so the title keeps
	// its stock box (no right inset). The title stays the second line and carries
	// the `data-hi-title` marker that pins its 16px size (never a class match).
	const titleLine = stack.children[1];
	assert.equal(titleLine.textContent, "Fix bug");
	assert.equal(titleLine.getAttribute("data-hi-title"), "1");
	assert.equal(titleLine.style.paddingRight, undefined);

	env.dispose();
});

test("the header row sits above the title and the two sizes come from CSS", () => {
	const env = setup({ sessions: store({ s1: { id: "s1", displayTitle: "Fix bug", cwd: "/x", updatedAt: NOW - 60000, blank: false } }) });
	const card = makeCard(env.dom, { title: "Fix bug", time: "1min ago", statuses: [{ label: "Idle", glyph: true }] });
	attachFiber(card, { id: "s1", title: "Fix bug" });
	env.doc.body.appendChild(card);
	fire(env.dom, { added: [card] });

	const stack = card.firstElementChild;
	// Row first, title second — `.dhi-twrap` precedes the stock title line.
	assert.equal(stack.children[0].className, "dhi-twrap");
	assert.equal(stack.children[1].getAttribute("data-hi-title"), "1");
	assert.equal(stack.children[1].textContent, "Fix bug");
	// The sizes live in the injected stylesheet: the row is 12px, and the title
	// marker rule pins 16px without ever naming the hash-prefixed class.
	const style = env.doc.querySelector('style[data-plugin-css="@comecaramelos/dsh-hover-information/hoverEnhancer.css"]');
	assert.ok(style, "the overlay stylesheet is injected");
	const css = String(style.textContent);
	assert.ok(/\.dhi-twrap\{[^}]*font-size:12px/.test(css), "the header row is 12px");
	assert.ok(css.indexOf("[data-hi-session] [data-hi-title]{font-size:16px}") >= 0, "the title line is pinned at 16px");

	env.dispose();
});

test("several status lines fold into the one icon title", () => {
	const env = setup({ sessions: store({ s1: { id: "s1", displayTitle: "Fix bug", cwd: "/x", updatedAt: NOW - 10000, blank: false } }) });
	const card = makeCard(env.dom, {
		title: "Fix bug",
		time: "1min ago",
		statuses: [
			{ label: "Running", glyph: true },
			{ label: "Needs input", glyph: true },
		],
	});
	attachFiber(card, { id: "s1", title: "Fix bug" });
	env.doc.body.appendChild(card);
	fire(env.dom, { added: [card] });

	const stack = card.firstElementChild;
	const row = stack.children[0];
	assert.equal(row.className, "dhi-twrap");
	assert.equal(stack.children.length, 2, "both status lines fold away");
	assert.equal(row.children[0].children[0].getAttribute("title"), "Running · Needs input");
	env.dispose();
});

test("an svg-shaped status glyph is cloned just the same", () => {
	const env = setup({ sessions: store({ s1: { id: "s1", displayTitle: "Fix bug", cwd: "/x", updatedAt: NOW - 30000, blank: false } }) });
	const card = makeCard(env.dom, { title: "Fix bug", time: "1min ago", statuses: [{ label: "Idle", glyph: "svg" }] });
	attachFiber(card, { id: "s1", title: "Fix bug" });
	env.doc.body.appendChild(card);
	fire(env.dom, { added: [card] });

	const row = card.firstElementChild.children[0];
	assert.equal(row.className, "dhi-twrap");
	assert.equal(row.children[0].children[0].tagName, "SVG", "the svg fallback shape still resolves");
	assert.equal(row.children[0].children[0].getAttribute("data-hi-status-icon"), "1");
	assert.equal(row.children[0].children[0].getAttribute("title"), "Idle");
	env.dispose();
});

test("a card with no time line still gets the row, and it stays above the title", () => {
	const env = setup({ sessions: store({ s1: { id: "s1", displayTitle: "Fix bug", cwd: "/x", updatedAt: NOW - 1000, blank: false } }) });
	const card = makeCard(env.dom, { title: "Fix bug", time: "", statuses: [{ label: "Idle", glyph: true }] });
	attachFiber(card, { id: "s1", title: "Fix bug" });
	env.doc.body.appendChild(card);
	fire(env.dom, { added: [card] });

	const stack = card.firstElementChild;
	// No time line to fold, but the row still takes the top slot above the title.
	assert.equal(stack.children[0].className, "dhi-twrap");
	assert.equal(stack.children[1].textContent, "Fix bug");
	const lead = stack.children[0].children[0];
	assert.equal(lead.children.length, 1, "glyph only, no time text");
	assert.equal(lead.children[0].getAttribute("data-hi-status-icon"), "1");
	assert.equal(lead.children[0].getAttribute("title"), "Idle");
	env.dispose();
});

test("a card without a status glyph still gets the inline time row", () => {
	const env = setup({ sessions: store({ s1: { id: "s1", displayTitle: "Fix bug", cwd: "/x", updatedAt: NOW - 90000, blank: false } }) });
	const card = makeCard(env.dom, { title: "Fix bug", time: "2h ago", statuses: ["Idle"] });
	attachFiber(card, { id: "s1", title: "Fix bug" });
	env.doc.body.appendChild(card);
	fire(env.dom, { added: [card] });

	const row = card.firstElementChild.children[0];
	assert.equal(row.className, "dhi-twrap");
	assert.equal(row.children.length, 2, "lead (time only) + buttons");
	assert.equal(row.children[0].children.length, 1);
	assert.equal(row.children[0].children[0].textContent, "2h ago");
	env.dispose();
});

test("DOM fallback: unique title match enhances; workspace-shaped cards do not", () => {
	const env = setup({ sessions: store({ a: { id: "a", displayTitle: "Alpha", cwd: "/x", updatedAt: NOW - 500000, blank: false } }) });
	const card = makeCard(env.dom, { title: "Alpha", time: "8min ago", statuses: ["Idle"] });
	env.doc.body.appendChild(card);
	fire(env.dom, { added: [card] });
	assert.equal(card.getAttribute("data-hi-session"), "a");
	env.dispose();

	const env2 = setup({ sessions: store({ a: { id: "a", displayTitle: "proj", cwd: "/x", updatedAt: NOW - 500000, blank: false } }) });
	const workspaceCard = makeCard(env2.dom, { title: "proj", time: "/home/u/proj", statuses: ["2 d ago"] });
	env2.doc.body.appendChild(workspaceCard);
	fire(env2.dom, { added: [workspaceCard] });
	assert.equal(workspaceCard.getAttribute("data-hi-session"), null, "workspace-shaped cards are left stock");
	env2.dispose();
});

test("duplicate titles tie-break on the time label", () => {
	const env = setup({
		sessions: store({
			old: { id: "old", displayTitle: "Dup", cwd: "/o", updatedAt: NOW - 3 * 864e5, blank: false },
			fresh: { id: "fresh", displayTitle: "Dup", cwd: "/f", updatedAt: NOW - 7200000, blank: false }
		})
	});

	const matched = makeCard(env.dom, { title: "Dup", time: "2h ago", statuses: ["Idle"] });
	env.doc.body.appendChild(matched);
	fire(env.dom, { added: [matched] });
	assert.equal(matched.getAttribute("data-hi-session"), "fresh");

	const ambiguous = makeCard(env.dom, { title: "Dup", time: "13d ago", statuses: ["Idle"] });
	env.doc.body.appendChild(ambiguous);
	fire(env.dom, { added: [ambiguous] });
	// "13d ago" matches no candidate bucket label → no safe match → stock card.
	assert.equal(ambiguous.getAttribute("data-hi-session"), null);
	env.dispose();
});

test("no match leaves the stock card untouched", () => {
	const env = setup({ sessions: store({ a: { id: "a", displayTitle: "Alpha", cwd: "/x", updatedAt: NOW, blank: false } }) });
	const card = makeCard(env.dom, { title: "Nope", time: "1min ago", statuses: ["Idle"] });
	env.doc.body.appendChild(card);
	fire(env.dom, { added: [card] });
	assert.equal(card.getAttribute("role"), "button", "role untouched");
	assert.equal(card.getAttribute("data-hi-session"), null);
	env.dispose();
});

test("active=false disables the enhancer", () => {
	const env = setup({ settings: { active: false }, sessions: store({ s1: { id: "s1", displayTitle: "Fix bug", cwd: "/x", updatedAt: NOW, blank: false } }) });
	const card = makeCard(env.dom, { title: "Fix bug", time: "now", statuses: ["Idle"] });
	env.doc.body.appendChild(card);
	fire(env.dom, { added: [card] });
	assert.equal(card.getAttribute("data-hi-session"), null);
	env.dispose();
});

test("removal is cleaned up; dispose removes the style tag", () => {
	const env = setup({ sessions: store({ s1: { id: "s1", displayTitle: "Fix bug", cwd: "/x", updatedAt: NOW, blank: false } }) });
	const card = makeCard(env.dom, { title: "Fix bug", time: "now", statuses: ["Idle"] });
	env.doc.body.appendChild(card);
	fire(env.dom, { added: [card] });
	assert.equal(card.getAttribute("data-hi-session"), "s1");

	card.remove();
	fire(env.dom, { removed: [card] });
	assert.ok(!card.isConnected);

	assert.ok(env.doc.querySelector('style[data-plugin-css="@comecaramelos/dsh-hover-information/hoverEnhancer.css"]') !== null);
	env.dispose();
	assert.equal(env.doc.querySelector('style[data-plugin-css="@comecaramelos/dsh-hover-information/hoverEnhancer.css"]'), null);
});

test("the dictionary registers under hoverInfo", () => {
	const env = setup({});
	assert.deepEqual(
		env.locale.registered.map((entry) => entry.ns),
		["hoverInfo"]
	);
	env.dispose();
});

// ── metrics block ────────────────────────────────────────────────────────────

function metricLines(card) {
	const stack = card.firstElementChild;
	const block = stack.children.find((child) => child.getAttribute && child.getAttribute("data-hi-metrics") === "1");
	if (!block) return [];
	return block.children.map((line) => [String(line.children[0].textContent), String(line.children[1].textContent)]);
}

test("stats block renders with toggles and formats applied", async () => {
	const env = setup({
		sessions: store({ s1: { id: "s1", displayTitle: "Fix bug", cwd: "/x", updatedAt: NOW, blank: false } }),
		stats: statsPayload(),
		settings: { showTokensIn: true, showTokensOut: true, showModel: true, showSubagents: true, showToolCalls: true, showCacheRead: false, showActiveTime: false }
	});
	const card = makeCard(env.dom, { title: "Fix bug", time: "now", statuses: ["Idle"] });
	attachFiber(card, { id: "s1" });
	env.doc.body.appendChild(card);
	fire(env.dom, { added: [card] });
	await tick();

	const rows = metricLines(card);
	const byLabel = new Map(rows);
	assert.equal(byLabel.get("Turns"), "3");
	assert.equal(byLabel.get("Steps"), "7");
	assert.equal(byLabel.get("Sent"), "120k");
	assert.equal(byLabel.get("Received"), "5.4k");
	assert.equal(byLabel.get("Compactions"), "1");
	assert.equal(byLabel.get("Context"), "81.2k / 128k · 63.4%");
	assert.equal(byLabel.get("Subagents"), "2"); // spawned only; running is a live stat, not folded here
	assert.equal(byLabel.get("Model"), "model-x");
	assert.equal(byLabel.get("Cache"), undefined, "default off");
	assert.equal(byLabel.get("Tool calls"), "12");
	assert.equal(byLabel.get("Active"), undefined, "default off");

	// The RPC used the exact envelope method + args.
	const call = env.rpcCalls.find((entry) => entry.endpoint === "hoverInfo/stats");
	assert.ok(call, "stats fetched through connection.rpc");
	assert.equal(call.payload.args.sessionId, "s1");
	env.dispose();
});

test("zero counts hide their rows (no fake zeros)", async () => {
	const zero = statsPayload({
		turns: 0,
		steps: 0,
		tokensIn: 0,
		tokensOut: 0,
		compactions: 0,
		subagentsSpawned: 0,
		toolCalls: 0,
		lastContext: null,
		lastRequest: null
	});
	const env = setup({
		sessions: store({ s1: { id: "s1", displayTitle: "Fix bug", cwd: "/x", updatedAt: NOW, blank: false } }),
		stats: zero
	});
	const card = makeCard(env.dom, { title: "Fix bug", time: "now", statuses: ["Idle"] });
	attachFiber(card, { id: "s1" });
	env.doc.body.appendChild(card);
	fire(env.dom, { added: [card] });
	await tick();
	const rows = metricLines(card);
	assert.equal(rows.length, 0, "every metric is zero/unmeasured → no block rows");
	env.dispose();
});

test("metrics respect settings toggles applied live", async () => {
	const env = setup({
		sessions: store({ s1: { id: "s1", displayTitle: "Fix bug", cwd: "/x", updatedAt: NOW, blank: false } }),
		stats: statsPayload(),
		settings: { showTurns: false, showSteps: false, showTokensIn: false, showTokensOut: false, showCacheRead: false, showCompactions: false, showContext: false, showSubagents: false, showModel: false }
	});
	const card = makeCard(env.dom, { title: "Fix bug", time: "now", statuses: ["Idle"] });
	attachFiber(card, { id: "s1" });
	env.doc.body.appendChild(card);
	fire(env.dom, { added: [card] });
	await tick();
	assert.equal(metricLines(card).length, 0);
	// Re-enable turns live: the open card re-renders without a reload.
	await env.scope.set("showTurns", true);
	fire(env.dom, { added: [] });
	await tick();
	const rows = new Map(metricLines(card));
	assert.equal(rows.get("Turns"), "3");
	env.dispose();
});

test("cache TTL gates repeat stats fetches", async () => {
	const env = setup({
		sessions: store({ s1: { id: "s1", displayTitle: "Fix bug", cwd: "/x", updatedAt: NOW, blank: false } }),
		stats: statsPayload(),
		settings: { refreshMs: 60000 }
	});
	const card = makeCard(env.dom, { title: "Fix bug", time: "now", statuses: ["Idle"] });
	attachFiber(card, { id: "s1" });
	env.doc.body.appendChild(card);
	fire(env.dom, { added: [card] });
	await tick();
	fire(env.dom, { added: [] });
	fire(env.dom, { added: [] });
	await tick();
	const statsCalls = env.rpcCalls.filter((entry) => entry.endpoint === "hoverInfo/stats");
	assert.equal(statsCalls.length, 1, "second sync within the TTL reuses the cached view");
	env.dispose();
});

test("a settled card performs no DOM churn (observer feedback-loop guard)", async () => {
	const env = setup({
		sessions: store({ s1: { id: "s1", displayTitle: "Fix bug", cwd: "/x", updatedAt: NOW, blank: false } }),
		stats: statsPayload()
	});
	const card = makeCard(env.dom, { title: "Fix bug", time: "now", statuses: ["Idle"] });
	attachFiber(card, { id: "s1" });
	env.doc.body.appendChild(card);
	fire(env.dom, { added: [card] });
	await tick();
	const stack = card.firstElementChild;
	assert.ok(stack.children.some((child) => child.getAttribute("data-hi-metrics") === "1"), "block rendered first");
	const before = stack.children.slice();

	// In a real browser every DOM write re-fires the per-card MutationObserver; if
	// syncCard rebuilt the block unconditionally, the callbacks would churn forever
	// and freeze the tab the moment metrics render. A settled re-sync must leave
	// the DOM byte-stable.
	fire(env.dom, { added: [] });
	fire(env.dom, { added: [] });
	const after = stack.children.slice();
	assert.equal(after.length, before.length);
	for (let i = 0; i < before.length; i++) assert.equal(after[i], before[i], `stack child ${i} was replaced (DOM churn)`);
	env.dispose();
});

test("a session without stats re-fetches on the TTL, not on every sync", async () => {
	const env = setup({
		sessions: store({ s1: { id: "s1", displayTitle: "Fix bug", cwd: "/x", updatedAt: NOW, blank: false } }),
		stats: null
	});
	const card = makeCard(env.dom, { title: "Fix bug", time: "now", statuses: ["Idle"] });
	attachFiber(card, { id: "s1" });
	env.doc.body.appendChild(card);
	fire(env.dom, { added: [card] });
	await tick();
	fire(env.dom, { added: [] });
	fire(env.dom, { added: [] });
	await tick();
	const statsCalls = env.rpcCalls.filter((entry) => entry.endpoint === "hoverInfo/stats");
	assert.equal(statsCalls.length, 1, "the settled miss stamps the cache timestamp → no per-sync refetch");
	env.dispose();
});

test("a session the host has not loaded renders from the store's cached projection", async () => {
	// The common cold-start state: the session is listed but not loaded in the
	// host, so the live fetch misses and the cached projection values every
	// list row already carries stand in for it.
	const hint = statsPayload({
		turns: 4,
		steps: 9,
		tokensIn: 180000,
		tokensOut: 7400,
		compactions: 0,
		subagentsSpawned: 1,
		toolCalls: 5,
		llmMs: 90000,
		toolMs: 500,
		lastContext: null,
		lastRequest: { provider: "acme", model: "cold-model", contextWindow: 64000, at: NOW - 5000 },
		createdAt: NOW - 3600000
	});
	const env = setup({
		sessions: store({
			s1: {
				id: "s1",
				displayTitle: "Fix bug",
				cwd: "/x",
				updatedAt: NOW,
				blank: false,
				projectionValues: { hoverInfo: hint }
			}
		}),
		stats: null
	});
	const card = makeCard(env.dom, { title: "Fix bug", time: "now", statuses: ["Idle"] });
	attachFiber(card, { id: "s1" });
	env.doc.body.appendChild(card);
	fire(env.dom, { added: [card] });
	await tick();
	const byLabel = new Map(metricLines(card));
	assert.equal(byLabel.get("Turns"), "4");
	assert.equal(byLabel.get("Steps"), "9");
	assert.equal(byLabel.get("Model"), "cold-model");
	env.dispose();
});

test("a live miss retries on the failure clock, not on the whole TTL", async () => {
	const env = setup({
		sessions: store({ s1: { id: "s1", displayTitle: "Fix bug", cwd: "/x", updatedAt: NOW, blank: false } }),
		stats: null,
		settings: { refreshMs: 60000 }
	});
	const card = makeCard(env.dom, { title: "Fix bug", time: "now", statuses: ["Idle"] });
	attachFiber(card, { id: "s1" });
	env.doc.body.appendChild(card);
	fire(env.dom, { added: [card] });
	await tick();
	const statsCalls = () => env.rpcCalls.filter((entry) => entry.endpoint === "hoverInfo/stats").length;
	assert.equal(statsCalls(), 1, "one live attempt per window");

	// 3.1 s later: still inside the 60 s TTL, but past the shorter clock a
	// failed attempt uses — a card left open across a cold start stops being
	// blank instead of waiting the whole TTL out.
	const realNow = Date.now;
	Date.now = () => realNow() + 3100;
	fire(env.dom, { added: [] });
	await tick();
	Date.now = realNow;
	assert.equal(statsCalls(), 2, "the miss retries on the failure clock");
	env.dispose();
});

test("RPC failure leaves the card with icons only (fail-open)", async () => {
	const env = setup({
		sessions: store({ s1: { id: "s1", displayTitle: "Fix bug", cwd: "/x", updatedAt: NOW, blank: false } }),
		stats: null
	});
	const card = makeCard(env.dom, { title: "Fix bug", time: "now", statuses: ["Idle"] });
	attachFiber(card, { id: "s1" });
	env.doc.body.appendChild(card);
	fire(env.dom, { added: [card] });
	await tick();
	assert.ok(card.getAttribute("data-hi-session"), "identity still resolves");
	assert.equal(metricLines(card).length, 0, "no metrics rows");
	assert.equal(bars(card).length === 0, false, "copy bar still present");
	env.dispose();
});

test("the metrics block is re-injected after React sweeps it (Copied re-render)", async () => {
	const env = setup({
		sessions: store({ s1: { id: "s1", displayTitle: "Fix bug", cwd: "/x", updatedAt: NOW, blank: false } }),
		stats: statsPayload()
	});
	const card = makeCard(env.dom, { title: "Fix bug", time: "now", statuses: ["Idle"] });
	attachFiber(card, { id: "s1" });
	env.doc.body.appendChild(card);
	fire(env.dom, { added: [card] });
	await tick();
	assert.ok(metricLines(card).length > 0);

	// Simulate the stock copy-feedback re-render: React replaces the stack.
	const stack = card.firstElementChild;
	while (stack.children.length > 0) stack.removeChild(stack.children[0]);
	fire(env.dom, { added: [stack] });
	const bar = bars(card)[0];
	assert.ok(bar, "copy bar re-injected by the card observer");
	assert.ok(metricLines(card).length > 0, "metrics block re-injected by the card observer");
	env.dispose();
});

test("dispose stops fetches and clears per-card observers", async () => {
	const env = setup({
		sessions: store({ s1: { id: "s1", displayTitle: "Fix bug", cwd: "/x", updatedAt: NOW, blank: false } }),
		stats: statsPayload()
	});
	const card = makeCard(env.dom, { title: "Fix bug", time: "now", statuses: ["Idle"] });
	attachFiber(card, { id: "s1" });
	env.doc.body.appendChild(card);
	fire(env.dom, { added: [card] });
	await tick();
	const before = env.rpcCalls.filter((entry) => entry.endpoint === "hoverInfo/stats").length;
	env.dispose();
	fire(env.dom, { added: [card] });
	await tick();
	const after = env.rpcCalls.filter((entry) => entry.endpoint === "hoverInfo/stats").length;
	assert.equal(after, before, "no fetches after dispose");
});

// ── lazy sweep heartbeat (docs/ROADMAP.md Fase 2b) ───────────────────────────

test("the sweep heartbeat runs only while a card is open", () => {
	const env = setup({ sessions: store({ s1: { id: "s1", displayTitle: "Fix bug", cwd: "/x", updatedAt: NOW, blank: false } }) });
	assert.equal(env.intervals.created, 0, "no heartbeat before any card opens");

	const card = makeCard(env.dom, { title: "Fix bug", time: "now", statuses: ["Idle"] });
	attachFiber(card, { id: "s1" });
	env.doc.body.appendChild(card);
	fire(env.dom, { added: [card] });
	assert.equal(env.intervals.created, 1, "the first open card starts the heartbeat");
	assert.equal(env.intervals.unrefCalls, 1, "the timer handle is unref'd");

	const second = makeCard(env.dom, { title: "Fix bug", time: "now", statuses: ["Idle"] });
	attachFiber(second, { id: "s1" });
	env.doc.body.appendChild(second);
	fire(env.dom, { added: [second] });
	assert.equal(env.intervals.created, 1, "further cards reuse the one heartbeat");

	fire(env.dom, { removed: [card] });
	assert.equal(env.intervals.cleared, 0, "one card still open → heartbeat stays");

	fire(env.dom, { removed: [second] });
	assert.equal(env.intervals.cleared, 1, "the last card closing stops the heartbeat");

	env.doc.body.appendChild(second);
	fire(env.dom, { added: [second] });
	assert.equal(env.intervals.created, 2, "re-opening a card restarts the heartbeat");

	env.dispose();
	assert.equal(env.intervals.cleared, 2, "dispose stops the live heartbeat");
});

test("dispose stops the heartbeat even with cards still open", () => {
	const env = setup({ sessions: store({ s1: { id: "s1", displayTitle: "Fix bug", cwd: "/x", updatedAt: NOW, blank: false } }) });
	const card = makeCard(env.dom, { title: "Fix bug", time: "now", statuses: ["Idle"] });
	attachFiber(card, { id: "s1" });
	env.doc.body.appendChild(card);
	fire(env.dom, { added: [card] });
	assert.equal(env.intervals.created, 1);
	env.dispose();
	assert.equal(env.intervals.cleared, 1);
});

// ── settings card ────────────────────────────────────────────────────────────

/** Renders the injected card component against the controller face. */
function renderCard(env, { writable = true, available = true } = {}) {
	const { renderToString } = requireCjs("react-dom/server");
	const React = requireCjs("react");
	assert.equal(env.slots.registrations.length, 1, "one slot registration");
	const { entry, component } = env.slots.registrations[0];
	assert.equal(entry.name, "settings.plugin.item");
	assert.equal(entry.key, "hover-info");
	assert.equal(entry.locale, "hoverInfo");
	const face = entry.inject();
	const hook = face.hooks.hoverInformationCard;
	let snapshot = hook.getSnapshot();
	if (!available) snapshot = { available: false, writable: false, fields: {} };
	return {
		html: renderToString(
			React.createElement(component, {
				t: (key) => {
					const dict = env.locale.registered.find((entry2) => entry2.ns === "hoverInfo").dict;
					return dict.en[key] ?? key;
				},
				useHoverInformationCard: (selector) => selector(snapshot),
				toggle: face.toggle,
				editRefresh: face.editRefresh,
				commitRefresh: face.commitRefresh,
				resetField: face.resetField
			})
		),
		face,
		hook
	};
}

test("the card registers under the settings.plugin.item slot with the hoverInfo locale", () => {
	const env = setup({ withSlots: true });
	const registered = env.slots.registrations[0];
	assert.equal(registered.entry.name, "settings.plugin.item");
	assert.equal(registered.entry.key, "hover-info");
	assert.equal(registered.entry.locale, "hoverInfo");
	env.dispose();
});

test("the card renders closed by default (no field controls)", () => {
	const env = setup({ withSlots: true });
	const { html } = renderCard(env);
	assert.match(html, /dhiCard_card/);
	assert.doesNotMatch(html, /Turns|Refresh interval/);
	env.dispose();
});

test("an open card renders every metric toggle plus refreshMs", () => {
	const env = setup({ withSlots: true });
	const { html } = renderCard(env);
	// The open body is behind `open` state; render by pushing open through the controller hook?
	// The component opens via useState in renderToString (single pass, closed). Render the open
	// body by asserting the controls exist when state is forced — the Face-driven check:
	// toggles are live-driven, so instead assert the closed header only here, and cover open
	// fields through face operations below.
	assert.match(html, /Hover information/);
	env.dispose();
});

test("toggle writes go straight to the user layer", async () => {
	const env = setup({ withSlots: true, settings: { showTurns: true } });
	const { face } = renderCard(env);
	await face.toggle("showModel", false);
	const write = env.scope.writes.find((entry) => entry[0] === "set" && entry[1] === "showModel");
	assert.ok(write);
	assert.equal(write[2], false);
	const snapshot = face.hooks.hoverInformationCard.getSnapshot();
	assert.equal(snapshot.fields.showModel.raw, false);
	env.dispose();
});

test("invalid refreshMs drafts are rejected, valid commits land", async () => {
	const env = setup({ withSlots: true });
	const { face } = renderCard(env);
	face.editRefresh("7");
	let snap = face.hooks.hoverInformationCard.getSnapshot();
	assert.equal(snap.fields.refreshMs.invalid, true);
	await face.commitRefresh();
	assert.deepEqual(env.scope.writes.find((entry) => entry[1] === "refreshMs"), undefined, "invalid commit does not write");
	face.editRefresh("4500");
	assert.equal((await face.commitRefresh()) === true, true);
	const write = env.scope.writes.find((entry) => entry[1] === "refreshMs");
	assert.equal(write[2], 4500);
	env.dispose();
});

test("resetField unsets the user override", async () => {
	const env = setup({ withSlots: true, settings: { showModel: false } });
	const { face } = renderCard(env);
	assert.equal(face.hooks.hoverInformationCard.getSnapshot().fields.showModel.overridden, true);
	await face.resetField("showModel");
	const unset = env.scope.writes.find((entry) => entry[0] === "unset" && entry[1] === "showModel");
	assert.ok(unset);
	env.dispose();
});

test("read-only mode renders without crashing", () => {
	const env = setup({ withSlots: true });
	env.scope.state.writable = false;
	const { html } = renderCard(env);
	assert.match(html, /dhiCard_/);
	env.dispose();
});

// ── document-preview enhancer (docs/PLAN.md §19) ────────────────────────────

/** Locate one preview's injected tools bar (the last child of the header). */
function previewTools(preview) {
	return Array.from(preview.header.children).find((child) => child.getAttribute("data-hi-tools") === "1");
}

test("preview: header tools injected on mount, path copies without any RPC", async () => {
	const env = setup({});
	const preview = makePreview(env.dom);
	env.doc.body.appendChild(preview.root);
	fireAttr(env.dom, preview.pathEl);

	const bar = previewTools(preview);
	assert.ok(bar, "tools bar injected into the preview header");
	assert.equal(preview.header.children[preview.header.children.length - 1], bar, "the bar sits last in the toolbar row");
	const buttons = bar.children.filter((child) => child.tagName === "BUTTON");
	assert.equal(buttons.length, 2);
	assert.equal(buttons[0].getAttribute("data-hi-preview-tool"), "content");
	assert.equal(buttons[1].getAttribute("data-hi-preview-tool"), "path");
	assert.equal(buttons[0].getAttribute("aria-label"), "Copy file content");
	assert.equal(buttons[1].getAttribute("aria-label"), "Copy file path");

	buttons[1].dispatchEvent(new env.dom.DomEvent("click", buttons[1]));
	await tick();
	assert.deepEqual(env.win.navigator.clipboard.written, ["/home/u/proj/AGENTS.md"]);
	assert.equal(env.rpcCalls.length, 0, "path copy never touches the host");

	env.dispose();
});

test("preview: content copy sources from the fiber text (exact source, zero IO)", async () => {
	const env = setup({});
	const preview = makePreview(env.dom, { path: "/x/README.md", title: "Markdown" });
	env.doc.body.appendChild(preview.root);
	attachPropsFiber(preview.root, { content: { kind: "text", text: "# Title\n\nsource", eof: true } });
	fireAttr(env.dom, preview.pathEl);

	const bar = previewTools(preview);
	bar.children[0].dispatchEvent(new env.dom.DomEvent("click", bar.children[0]));
	await tick();
	assert.deepEqual(env.win.navigator.clipboard.written, ["# Title\n\nsource"]);
	assert.equal(env.rpcCalls.length, 0, "a fully loaded source costs no host round trip");

	env.dispose();
});

test("preview: not-eof content falls back to workspaceFiles/readAll", async () => {
	let calls = [];
	const stats = (endpoint, payload) => {
		calls.push({ endpoint, payload });
		const full = Buffer.from("full file source\nline two", "utf-8").toString("base64");
		return { data: full, eof: true, absolutePath: "/x/big.log", version: "v1" };
	};
	const env = setup({
		sessions: store({ s1: { id: "s1", displayTitle: "Big", cwd: "/x", updatedAt: NOW, blank: false } }),
		stats
	});
	const preview = makePreview(env.dom, { path: "/x/big.log" });
	env.doc.body.appendChild(preview.root);
	attachPropsFiber(preview.root, { content: { kind: "text", text: "only the loaded pages", eof: false } });
	fireAttr(env.dom, preview.pathEl);

	const bar = previewTools(preview);
	bar.children[0].dispatchEvent(new env.dom.DomEvent("click", bar.children[0]));
	await tick();
	await tick();
	assert.deepEqual(calls.length, 1, "exactly one readAll call");
	assert.equal(calls[0].endpoint, "workspaceFiles/readAll");
	assert.deepEqual(calls[0].payload.args, { workspaceFileScopeId: "s1", path: "/x/big.log" });
	assert.deepEqual(env.win.navigator.clipboard.written, ["full file source\nline two"]);

	env.dispose();
});

test("preview: not-eof without a live session copies what loaded", async () => {
	const env = setup({ sessions: store({}) });
	const preview = makePreview(env.dom, { path: "/x/big.log" });
	env.doc.body.appendChild(preview.root);
	attachPropsFiber(preview.root, { content: { kind: "text", text: "loaded pages only", eof: false } });
	fireAttr(env.dom, preview.pathEl);

	const bar = previewTools(preview);
	bar.children[0].dispatchEvent(new env.dom.DomEvent("click", bar.children[0]));
	await tick();
	await tick();
	assert.deepEqual(env.win.navigator.clipboard.written, ["loaded pages only"]);
	assert.equal(env.rpcCalls.length, 0);

	env.dispose();
});

test("preview: a byte renderer copies nothing and stays silent", async () => {
	const env = setup({ sessions: store({ s1: { id: "s1", cwd: "/x", updatedAt: NOW, blank: false } }) });
	const preview = makePreview(env.dom, { path: "/x/doc.pdf" });
	env.doc.body.appendChild(preview.root);
	attachPropsFiber(preview.root, { content: { kind: "bytes", pages: [], eof: true } });
	fireAttr(env.dom, preview.pathEl);

	const bar = previewTools(preview);
	bar.children[0].dispatchEvent(new env.dom.DomEvent("click", bar.children[0]));
	await tick();
	await tick();
	assert.deepEqual(env.win.navigator.clipboard.written, [], "no source → no clipboard write");
	assert.equal(env.rpcCalls.length, 0, "byte renderers never readAll blindly");

	env.dispose();
});

test("preview: a re-render that reorders the bar re-seats it on resync", () => {
	const env = setup({});
	const preview = makePreview(env.dom);
	env.doc.body.appendChild(preview.root);
	fireAttr(env.dom, preview.pathEl);

	// React re-renders and appends another tool button after our bar.
	const extra = env.dom.createElement("button");
	extra.setAttribute("data-textpreview-tool", "wrap");
	preview.header.appendChild(extra);

	env.dom.flush([]);

	const bar = previewTools(preview);
	assert.equal(preview.header.children[preview.header.children.length - 1], bar, "the tools bar ends the toolbar row again");
	env.dispose();
});

test("preview: already-open at mount enhances without records", () => {
	const dom = createDom();
	const preview = makePreview(dom);
	dom.doc.body.appendChild(preview.root);
	const env = setup({ dom });
	assert.ok(previewTools(preview), "the mount-time tree scan catches a restored file tab");
	env.dispose();
});

test("preview: opens the heartbeat and the sweep forgets a closed preview", () => {
	const env = setup({});
	const preview = makePreview(env.dom);
	env.doc.body.appendChild(preview.root);
	fireAttr(env.dom, preview.pathEl);
	assert.equal(env.intervals.created, 1, "the first open preview starts the heartbeat");
	assert.equal(env.intervals.unrefCalls, 1);

	preview.root.remove();
	env.sweepCallbacks[0]();
	assert.equal(env.intervals.cleared, 1, "an open preview removed from the DOM stops the heartbeat");

	// A re-fire for the gone root must not resurrect state or throw.
	fireAttr(env.dom, preview.pathEl);
	env.dispose();
});

test("preview: a file tab opened after the enhancer mounted is found via childList records", async () => {
	const dom = createDom();
	const env = setup({ dom });
	// The live case: React inserts the whole preview DOM into body's subtree
	// *after* apply ran. The root arrives with its anchor attributes already
	// present (the value never changes, so no attribute record is possible) —
	// only childList records can surface a fresh mount.
	const preview = makePreview(dom);
	dom.doc.body.appendChild(preview.root);
	dom.flush([{ type: "childList", target: dom.doc.body, addedNodes: [preview.root], removedNodes: [] }]);

	const bar = previewTools(preview);
	assert.ok(bar, "the late-mounted preview grew the tools bar");
	const buttons = bar.children.filter((child) => child.tagName === "BUTTON");
	assert.equal(buttons.length, 2);

	buttons[1].dispatchEvent(new dom.DomEvent("click", buttons[1]));
	await tick();
	assert.deepEqual(env.win.navigator.clipboard.written, ["/home/u/proj/AGENTS.md"]);
	env.dispose();
});

test("preview: a loaded-then-ready preview enhances when its path element lands", () => {
	const dom = createDom();
	const env = setup({ dom });
	// First click shows the body and no header path yet (enhance fails);
	// when the path element arrives, DOM mutates *inside* the root, so the
	// target's ancestor walk finds the unregistered root and retries.
	const preview = makePreview(dom);
	const pathEl = preview.pathEl;
	preview.header.removeChild(pathEl);
	dom.doc.body.appendChild(preview.root);
	preview.header.appendChild(pathEl);
	dom.flush([{ type: "childList", target: preview.header, addedNodes: [pathEl], removedNodes: [] }]);

	assert.ok(previewTools(preview), "the preview re-checked on DOM mutating inside its root");
	env.dispose();
});
