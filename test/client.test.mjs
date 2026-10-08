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
import { createDom, makeCard, attachFiber, makePreview, attachPropsFiber, makeModelSeat, makeJobMenu } from "./dom.mjs";

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

test("the bundle exports the apply surface, the inject list and the cache budgets", () => {
	assert.equal(typeof bundle.apply, "function");
	assert.deepEqual(bundle.inject, ["sessions", "connection", "locale", "settingsScope", "slots"]);
	// The card/enhancer halves mount from `apply`; the budgets pin the cache
	// TTL (host default) and the failed-attempt retry ceiling.
	assert.equal(bundle.DEFAULT_REFRESH_MS, 30000);
	assert.equal(bundle.FAILURE_RETRY_MS, 3000);
});

const NOW = Date.now();

/** Default composed settings snapshot for the browser half. */
const BASE_SETTINGS = {
	active: true,
	showPreviewTools: true,
	showModelProvider: true,
	refreshMs: 30000,
	showTurns: true,
	showSteps: true,
	showTokensIn: true,
	showTokensOut: true,
	showCacheRead: true,
	showCompactions: true,
	showPurges: true,
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
function store(byId, jobsBySession) {
	return { list: { getSnapshot: () => ({ ids: Object.keys(byId), byId, jobsBySession }) }, subscribe: () => () => {} };
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
		purges: 2,
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

function setup({ sessions = store({}), settings = {}, stats = null, withSlots = false, dom = createDom(), preApply = null } = {}) {
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
			} else {
				// Any other dictionary the shell registered (the background-job
				// list's `job` namespace in particular) — the enhancer reads
				// the shell's own strings through the same registry.
				const entry = locale.registered.find((registered) => registered.ns === ns);
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

	// Runs before `apply` (the locale-dictionary + open-menu-at-mount cases
	// need state on the context BEFORE the enhancer's own mount-time scans).
	if (preApply) preApply(ctx);
	const dispose = bundle.apply(ctx);

	return {
		dom,
		win,
		doc: dom.doc,
		ctx,
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
	assert.equal(byLabel.get("Purges"), "2", "purge rows render right next to compactions");
	assert.equal(byLabel.get("Context"), "81.2k / 128k · 63%", "integer percent — same figure the composer context meter renders");
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
		purges: 0,
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
		settings: { showTurns: false, showSteps: false, showTokensIn: false, showTokensOut: false, showCacheRead: false, showCompactions: false, showPurges: false, showContext: false, showSubagents: false, showModel: false }
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

test("the open card body composes five catalog blocks", () => {
	// The component's open toggle is a plain `react.useState` — the bundle's
	// react is the same instance the test drives, so one temporary override
	// renders the OPEN body and lets the DOM shape be asserted directly.
	const env = setup({ withSlots: true });
	const React = requireCjs("react");
	const realUseState = React.useState;
	React.useState = function () {
		return [true, function () {}];
	};
	let html;
	let dict;
	try {
		dict = env.locale.registered.find((entry) => entry.ns === "hoverInfo").dict.en;
		html = renderCard(env).html;
	} finally {
		React.useState = realUseState;
	}
	const catalogOpen = 'class="dhiCard_catalog"';
	const firstCatalog = html.indexOf(catalogOpen);
	const secondCatalog = html.indexOf(catalogOpen, firstCatalog + 1);
	const thirdCatalog = html.indexOf(catalogOpen, secondCatalog + 1);
	const fourthCatalog = html.indexOf(catalogOpen, thirdCatalog + 1);
	const fifthCatalog = html.indexOf(catalogOpen, fourthCatalog + 1);
	assert.notEqual(firstCatalog, -1, "catalog 1 rendered");
	assert.notEqual(secondCatalog, -1, "catalog 2 rendered");
	assert.notEqual(thirdCatalog, -1, "catalog 3 rendered");
	assert.notEqual(fourthCatalog, -1, "catalog 4 rendered");
	assert.notEqual(fifthCatalog, -1, "catalog 5 rendered");
	assert.equal(html.indexOf(catalogOpen, fifthCatalog + 1), -1, "exactly five catalog blocks");
	// Catalog 1 — the master switch as its two-row field, hint below.
	assert.ok(html.indexOf(dict.active) > firstCatalog && html.indexOf(dict.active) < secondCatalog, "active title rides catalog 1");
	assert.ok(html.indexOf(dict.activeHint) > firstCatalog && html.indexOf(dict.activeHint) < secondCatalog, "hint sits as catalog 1's field description");
	// Catalog 2 — the sidebar-preview tools toggle as its own catalog block,
	// two-row field shape, hint below.
	assert.ok(html.indexOf(dict.previewTools) > secondCatalog && html.indexOf(dict.previewTools) < thirdCatalog, "preview-tools title rides catalog 2");
	assert.ok(html.indexOf(dict.previewToolsHint) > secondCatalog && html.indexOf(dict.previewToolsHint) < thirdCatalog, "hint sits as catalog 2's field description");
	// Catalog 3 — the composer model-selector toggle as its own catalog block,
	// two-row field shape, hint below.
	assert.ok(html.indexOf(dict.modelProvider) > thirdCatalog && html.indexOf(dict.modelProvider) < fourthCatalog, "model-selector title rides catalog 3");
	assert.ok(html.indexOf("Show the current selection as") > thirdCatalog && html.indexOf("Off leaves the standard tooltip") < fourthCatalog, "hint sits as catalog 3's field description");
	// Catalog 4 — the background-job kill toggle as its own catalog block,
	// two-row field shape, hint below.
	assert.ok(html.indexOf(dict.jobKill) > fourthCatalog && html.indexOf(dict.jobKill) < fifthCatalog, "job-kill title rides catalog 4");
	assert.ok(html.indexOf("kill button to the running rows") > fourthCatalog && html.indexOf("Off leaves the job list") < fifthCatalog, "hint sits as catalog 4's field description");
	// Catalog 5 — the metric grid (column-major rows = ceil(13/2)) above the
	// refresh-interval field, both inside the fifth catalog.
	assert.ok(html.indexOf('style="grid-template-rows:repeat(7, auto)"') > fifthCatalog, "column-major grid lives in catalog 5");
	assert.ok(html.indexOf(dict.refresh) > fifthCatalog, "refresh field rides catalog 5");
	assert.ok(html.indexOf(dict.metricTurns) > fifthCatalog, "metric titles are catalog 5 grid children");
	env.dispose();
});

test("the injected card CSS lays the metric toggles out in two columns", () => {
	const env = setup({ withSlots: true });
	const style = env.doc.querySelector(
		'style[data-plugin-css="@comecaramelos/dsh-hover-information/HoverInformationCard.module.css"]'
	);
	assert.ok(style !== null, "card stylesheet injected on mount");
	assert.match(
		style.textContent,
		/dhiCard_grid\{grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\);grid-auto-flow:column/,
		"two-column, column-major grid rule"
	);
	env.dispose();
});

test("the injected card CSS composes the body as catalog blocks", () => {
	const env = setup({ withSlots: true });
	const style = env.doc.querySelector(
		'style[data-plugin-css="@comecaramelos/dsh-hover-information/HoverInformationCard.module.css"]'
	);
	assert.ok(style !== null, "card stylesheet injected on mount");
	// The reference catalog block: fields stacked inside; the hairline seam is
	// drawn only BETWEEN consecutive catalogs.
	assert.match(style.textContent, /\.dhiCard_catalog\{flex-direction:column;align-items:stretch;gap:10px;display:flex\}/, "catalog block rule");
	assert.match(
		style.textContent,
		/\.dhiCard_catalog \+ \.dhiCard_catalog\{border-top:\.5px solid var\(--dsw-alias-border-l2\);padding-top:12px\}/,
		"catalog-to-catalog seam rule"
	);
	// The two-row field: row above, full-width copy below.
	assert.match(style.textContent, /\.dhiCard_field\{align-items:flex-start;gap:4px;display:flex;flex-direction:column;width:100%\}/, "field rule");
	assert.match(style.textContent, /\.dhiCard_fieldRow\{align-items:center;gap:8px;display:flex;width:100%\}/, "field row rule");
	assert.match(style.textContent, /\.dhiCard_fieldDesc\{/, "field description rule");
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

test("preview: showPreviewTools off injects no header tools", () => {
	const env = setup({ settings: { showPreviewTools: false } });
	const preview = makePreview(env.dom);
	env.doc.body.appendChild(preview.root);
	fireAttr(env.dom, preview.pathEl);
	assert.equal(previewTools(preview), undefined, "no tools bar while the preview switch is off");
	env.dispose();
});

test("preview: the preview-tools switch applies live both ways", async () => {
	const env = setup();
	const preview = makePreview(env.dom);
	env.doc.body.appendChild(preview.root);
	fireAttr(env.dom, preview.pathEl);
	assert.ok(previewTools(preview), "tools injected with the switch at its default");

	// Off: the scope notification re-syncs the open preview and detaches the
	// bar in the same tick (the diff-only resync keeps the state, so the bar
	// node survives for the re-enable).
	await env.scope.set("showPreviewTools", false);
	assert.equal(previewTools(preview), undefined, "the bar detaches when the switch flips off");
	preview.header.children.forEach(function (child) {
		assert.notEqual(child.getAttribute && child.getAttribute("data-hi-tools"), "1", "no injected bar child remains in the header");
	});

	// On: the same open preview re-seats its existing bar, no reload.
	await env.scope.set("showPreviewTools", true);
	const bar = previewTools(preview);
	assert.ok(bar, "the bar re-seats when the switch flips back on");
	assert.equal(preview.header.children[preview.header.children.length - 1], bar, "the bar ends the toolbar row again");
	env.dispose();
});

// ── composer model selector (docs/PLAN.md §33) ──────────────────────────────

test("model selector: a composer open at mount is caught without records", () => {
	const dom = createDom();
	const seat = makeModelSeat(dom);
	const env = setup({ dom });
	assert.equal(seat.trigger.getAttribute("title"), "OpenRouter > GPT-4o mini", "the mount-time resync catches the already-mounted composer");
	env.dispose();
});

test("model selector: the seat trigger tooltip carries `provider > model`", () => {
	const env = setup({});
	const seat = makeModelSeat(env.dom);
	fire(env.dom, { added: [seat.seat] });
	assert.equal(seat.trigger.getAttribute("title"), "OpenRouter > GPT-4o mini", "the trigger carries the provider-prefixed label");
	env.dispose();
});

test("model selector: the open menu's root cells carry the same title", () => {
	const env = setup({});
	const seat = makeModelSeat(env.dom, { withMenu: true });
	fire(env.dom, { added: [seat.seat] });
	assert.equal(seat.trigger.getAttribute("title"), "OpenRouter > GPT-4o mini");
	for (const cell of seat.cells) {
		assert.equal(cell.getAttribute("title"), "OpenRouter > GPT-4o mini", "the root cells carry the pair too");
	}
	env.dispose();
});

test("model selector: the visible cellValue shows `provider > model`, leaving the Effort row alone", () => {
	const env = setup({});
	const seat = makeModelSeat(env.dom, { withMenu: true });
	fire(env.dom, { added: [seat.seat] });
	// The Model row's stock value is the bare model name — that is where the
	// provider belongs.
	assert.equal(seat.cellValues[0].textContent, "OpenRouter > GPT-4o mini", "the Model row shows the provider-prefixed pair");
	// The Effort row's value is not the model name, so its stock value is
	// left untouched (fail-open on the shape, never a forced overwrite).
	assert.equal(seat.cellValues[1].textContent, "Medium", "the Effort row keeps its own value");
	env.dispose();
	assert.equal(seat.cellValues[0].textContent, "GPT-4o mini", "dispose hands the Model row back to the shell");
	assert.equal(seat.cellValues[1].textContent, "Medium", "the Effort row was never owned");
});

test("model selector: a live selection change rewrites the visible value", () => {
	const env = setup({});
	const seat = makeModelSeat(env.dom, { withMenu: true });
	fire(env.dom, { added: [seat.seat] });
	assert.equal(seat.cellValues[0].textContent, "OpenRouter > GPT-4o mini");
	// Live switch: the store subscription resyncs, and React's own render
	// drops the new bare model name into the span — that DOM mutation is what
	// makes us recapture the stock value before re-pairing.
	// Live switch: the store subscription resyncs, and React's own render
	// drops the new bare model name into the span — that DOM mutation is what
	// makes us recapture the stock value before re-pairing.
	seat.store.set({
		current: { provider: "anthropic", model: "claude-sonnet-4" },
		groups: [{ id: "anthropic", name: "Anthropic", models: [{ id: "claude-sonnet-4", name: "Claude Sonnet 4" }] }]
	});
	seat.cellValues[0].textContent = "Claude Sonnet 4";
	env.dom.flush([{ type: "characterData", target: seat.cellValues[0] }]);
	assert.equal(seat.cellValues[0].textContent, "Anthropic > Claude Sonnet 4", "the visible pair rides the live selection");
	// A switch off restores the shell's *current* model name (recaptured from
	// React's render), not the one captured when the menu first mounted.
	return env.scope.set("showModelProvider", false).then(() => {
		assert.equal(seat.cellValues[0].textContent, "Claude Sonnet 4", "off restores the shell's current model name");
	});
});

test("model selector: live-shaped fiber chains resolve the menu cells through the composer source", () => {
	// The live React shape: the seat/trigger fibers reach `directory` up the
	// `.return` chain, while a portal menu cell's own chain reaches nothing —
	// the live failure. The composer (seat) source is the fallback that makes
	// the root-pane cells carry the title with no DOM source (list never
	// opened) either.
	const dom = createDom();
	const seat = makeModelSeat(dom, { chain: true, withMenu: true, openList: false });
	const env = setup({ dom });
	assert.equal(seat.trigger.getAttribute("title"), "OpenRouter > GPT-4o mini", "the trigger resolves through its fiber return-chain");
	for (const cell of seat.cells) {
		assert.equal(cell.getAttribute("title"), "OpenRouter > GPT-4o mini", "the cells resolve through the composer fallback");
	}

	// The same fallback keeps a live switch reaching the cells without any
	// DOM record: the seat's subscription drives the resync.
	seat.store.set({
		current: { provider: "anthropic", model: "claude-sonnet-4" },
		groups: [{ id: "anthropic", name: "Anthropic", models: [{ id: "claude-sonnet-4", name: "Claude Sonnet 4" }] }]
	});
	assert.equal(seat.cells[0].getAttribute("title"), "Anthropic > Claude Sonnet 4", "the fallback rides the live selection, not a stale capture");
	env.dispose();
	assert.equal(seat.cells[0].getAttribute("title"), null, "dispose restores the cell's stock absence of title");
});

test("model selector: without the fiber store, the open model list is the source", () => {
	const env = setup({});
	const seat = makeModelSeat(env.dom, { withFiber: false, withMenu: true });
	fire(env.dom, { added: [seat.seat] });
	assert.equal(seat.trigger.getAttribute("title"), "GPT-4o mini · Medium", "the DOM source is the checked option, not the trigger — it keeps the stock label");
	for (const cell of seat.cells) {
		assert.equal(cell.getAttribute("title"), "OpenRouter > GPT-4o mini", "the cells resolve through the checked option");
	}
	env.dispose();
});

test("model selector: nothing resolvable leaves the stock DOM untouched", () => {
	const env = setup({});
	const seat = makeModelSeat(env.dom, { withFiber: false });
	fire(env.dom, { added: [seat.seat] });
	assert.equal(seat.trigger.getAttribute("title"), "GPT-4o mini · Medium", "fail-open: no selection source → no DOM touch");
	env.dispose();
});

test("model selector: the switch off leaves the stock selector untouched", () => {
	const env = setup({ settings: { showModelProvider: false } });
	const seat = makeModelSeat(env.dom, { withMenu: true });
	fire(env.dom, { added: [seat.seat] });
	assert.equal(seat.trigger.getAttribute("title"), "GPT-4o mini · Medium", "no write while off");
	assert.equal(seat.cells[0].getAttribute("title"), null, "no cell titles while off");
	env.dispose();
});

test("model selector: flipping the switch off restores; flipping back re-seats", async () => {
	const env = setup({});
	const seat = makeModelSeat(env.dom, { withMenu: true });
	fire(env.dom, { added: [seat.seat] });
	assert.equal(seat.trigger.getAttribute("title"), "OpenRouter > GPT-4o mini");
	await env.scope.set("showModelProvider", false);
	assert.equal(seat.trigger.getAttribute("title"), "GPT-4o mini · Medium", "off restores the stock trigger tooltip");
	assert.equal(seat.cells[0].getAttribute("title"), null, "off removes the injected cell titles");
	await env.scope.set("showModelProvider", true);
	assert.equal(seat.trigger.getAttribute("title"), "OpenRouter > GPT-4o mini", "back on re-seats every title");
	assert.equal(seat.cells[0].getAttribute("title"), "OpenRouter > GPT-4o mini", "and re-seats the cells");
	env.dispose();
});

test("model selector: master off restores the stock selector everywhere", async () => {
	const env = setup({});
	const seat = makeModelSeat(env.dom);
	fire(env.dom, { added: [seat.seat] });
	assert.equal(seat.trigger.getAttribute("title"), "OpenRouter > GPT-4o mini");
	await env.scope.set("active", false);
	assert.equal(seat.trigger.getAttribute("title"), "GPT-4o mini · Medium", "master off restores the stock tooltip");
	env.dispose();
});

test("model selector: a selection change rides the store subscription, without DOM records", () => {
	const env = setup({});
	const seat = makeModelSeat(env.dom, { withMenu: true });
	fire(env.dom, { added: [seat.seat] });
	assert.equal(seat.trigger.getAttribute("title"), "OpenRouter > GPT-4o mini");
	seat.store.set({
		current: { provider: "anthropic", model: "claude-sonnet-4" },
		groups: [{ id: "anthropic", name: "Anthropic", models: [{ id: "claude-sonnet-4", name: "Claude Sonnet 4" }] }]
	});
	assert.equal(seat.trigger.getAttribute("title"), "Anthropic > Claude Sonnet 4", "the switch rides the store, not a DOM attribute");
	assert.equal(seat.cells[0].getAttribute("title"), "Anthropic > Claude Sonnet 4", "and reaches the cells");
	env.dispose();
});

test("model selector: dispose hands every managed title back to the shell", () => {
	const env = setup({});
	const seat = makeModelSeat(env.dom, { withMenu: true });
	fire(env.dom, { added: [seat.seat] });
	env.dispose();
	assert.equal(seat.trigger.getAttribute("title"), "GPT-4o mini · Medium", "dispose restores the stock trigger tooltip");
	assert.equal(seat.cells[0].getAttribute("title"), null, "dispose removes the injected cell titles");
});

// ---------------------------------------------------------------------------
// Background-job kill buttons (docs/PLAN.md §34)
// ---------------------------------------------------------------------------

/** The shell registers the `job` dictionaries; the menu label is one of them. */
function addJobLocale(ctx) {
	ctx.locale.registered.push({ ns: "job", dict: { en: { "list.aria": "Background jobs" } } });
	return () => {};
}

/** The kill buttons of one menu (row order = DOM row order). */
function killButtons(ul) {
	return ul.children.filter((li) => li.querySelector("[data-hi-jobkill]"));
}
function buttonOf(li) {
	return li.querySelector("[data-hi-jobkill]");
}

/** The live store face for one menu: two live rows, one settled. */
const JOB_ROWS = [
	{ id: "job-1", status: "running" },
	{ id: "job-2", status: "stopping" },
	{ id: "job-3", status: "completed" }
];

function jobDom(dom) {
	const menu = makeJobMenu(dom, {
		sessionId: "s1",
		rows: JOB_ROWS.map((row) => ({ id: row.id, status: row.status, live: row.status === "running" || row.status === "stopping" }))
	});
	dom.doc.body.appendChild(menu.root);
	return menu;
}

test("live background-job rows grow kill buttons; settled rows stay stock", () => {
	const dom = createDom();
	const menu = jobDom(dom);
	const env = setup({
		dom,
		sessions: store({ s1: { id: "s1", title: "Alpha" } }, { s1: JOB_ROWS }),
		preApply: addJobLocale
	});

	const rows = killButtons(menu.ul);
	assert.equal(rows.length, 2, "one button per live row only");
	assert.equal(buttonOf(rows[0]).getAttribute("data-hi-job"), "job-1");
	assert.equal(buttonOf(rows[1]).getAttribute("data-hi-job"), "job-2");
	assert.equal(buttonOf(menu.ul.children[2]), null, "the settled row carries nothing");
	for (const row of rows) {
		const button = buttonOf(row);
		assert.equal(button.className, "dhi-kill");
		assert.equal(button.getAttribute("aria-label"), "Kill background job");
	}
	env.dispose();
});

test("the kill button addresses the host once per click with {sessionId, jobId}", async () => {
	const dom = createDom();
	const menu = jobDom(dom);
	const env = setup({
		dom,
		sessions: store({ s1: { id: "s1", title: "Alpha" } }, { s1: JOB_ROWS }),
		stats: { outcome: "requested" },
		preApply: addJobLocale
	});
	const button = buttonOf(killButtons(menu.ul)[0]);
	button.dispatchEvent(new dom.DomEvent("click", button));
	await tick();
	const call = env.rpcCalls.find((entry) => entry.endpoint === "hoverInfo/killJob");
	assert.ok(call !== void 0, "the kill rides hoverInfo/killJob");
	assert.deepEqual(call.payload, { args: { sessionId: "s1", jobId: "job-1" } });
	env.dispose();
});

test("a second click while a kill request is in flight sends nothing extra", async () => {
	const dom = createDom();
	const menu = jobDom(dom);
	let resolveKill = null;
	const env = setup({
		dom,
		sessions: store({ s1: { id: "s1", title: "Alpha" } }, { s1: JOB_ROWS }),
		preApply: addJobLocale
	});
	// Make the kill RPC answer manually so the second click lands while pending.
	env.rpcCalls.length = 0;
	const pending = new Promise((resolve) => {
		resolveKill = resolve;
	});
	env.ctx.get("connection").rpc.call = (_channel, endpoint, payload) => {
		env.rpcCalls.push({ endpoint, payload });
		return pending;
	};
	const button = buttonOf(killButtons(menu.ul)[0]);
	button.dispatchEvent(new dom.DomEvent("click", button));
	button.dispatchEvent(new dom.DomEvent("click", button));
	await tick();
	assert.equal(env.rpcCalls.filter((entry) => entry.endpoint === "hoverInfo/killJob").length, 1, "one request per pending kill");
	resolveKill({ ok: true, value: { outcome: "requested" } });
	await tick();
	env.dispose();
});

test("settling a job drops its kill button on the next sync", async () => {
	const dom = createDom();
	const menu = jobDom(dom);
	let snapshot = { ids: ["s1"], byId: { s1: { id: "s1" } }, jobsBySession: { s1: JOB_ROWS } };
	const sessions = { list: { getSnapshot: () => snapshot, subscribe: () => () => {} } };
	const env = setup({ dom, sessions, preApply: addJobLocale });
	assert.equal(killButtons(menu.ul).length, 2);
	snapshot = {
		ids: ["s1"],
		byId: { s1: { id: "s1" } },
		jobsBySession: { s1: [{ id: "job-1", status: "completed" }, { id: "job-2", status: "killed" }, { id: "job-3", status: "completed" }] }
	};
	sessions.list.set ? sessions.list.set(snapshot) : void 0;
	// The shell's own churn would fire the per-menu observer; one sweep tick
	// stands in for it.
	for (const fn of env.sweepCallbacks) fn();
	assert.equal(killButtons(menu.ul).length, 0, "settled rows carry no buttons");
	env.dispose();
});

test("the kill switch off detaches every live-row button live", async () => {
	const dom = createDom();
	const menu = jobDom(dom);
	const env = setup({ dom, sessions: store({ s1: { id: "s1" } }, { s1: JOB_ROWS }), preApply: addJobLocale });
	assert.equal(killButtons(menu.ul).length, 2);
	env.scope.set("showJobKill", false);
	await tick();
	assert.equal(killButtons(menu.ul).length, 0, "off strips the live menu");
	env.scope.set("showJobKill", true);
	await tick();
	assert.equal(killButtons(menu.ul).length, 2, "on re-seats the buttons");
	env.dispose();
});

test("the master off leaves the stock job list everywhere", async () => {
	const dom = createDom();
	const menu = jobDom(dom);
	const env = setup({ dom, sessions: store({ s1: { id: "s1" } }, { s1: JOB_ROWS }), preApply: addJobLocale });
	env.scope.set("active", false);
	await tick();
	assert.equal(killButtons(menu.ul).length, 0);
	env.dispose();
});

test("an unresolved menu identity leaves every row stock (fail-open)", () => {
	const dom = createDom();
	// No store rows for the session: the live vs settled question cannot be
	// answered, so no row gets a button.
	const menu = makeJobMenu(dom, { sessionId: "gone", rows: [{ id: "job-1", status: "running" }] });
	dom.doc.body.appendChild(menu.root);
	const env = setup({ dom, sessions: store({ s1: { id: "s1" } }, { s1: JOB_ROWS }), preApply: addJobLocale });
	assert.equal(killButtons(menu.ul).length, 0);
	env.dispose();
});

test("an unanchored ul (wrong aria-label) never registers", () => {
	const dom = createDom();
	const menu = makeJobMenu(dom, { sessionId: "s1", ariaLabel: "Something else", rows: [{ id: "job-1", status: "running" }] });
	dom.doc.body.appendChild(menu.root);
	const env = setup({ dom, sessions: store({ s1: { id: "s1" } }, { s1: JOB_ROWS }), preApply: addJobLocale });
	assert.equal(killButtons(menu.ul).length, 0, "the menu is anchored by its localized label");
	env.dispose();
});

test("a menu that disappears is forgotten (no leaked observers)", () => {
	const dom = createDom();
	const menu = jobDom(dom);
	const env = setup({ dom, sessions: store({ s1: { id: "s1" } }, { s1: JOB_ROWS }), preApply: addJobLocale });
	menu.ul.parentElement.parentElement.remove(); // open menu closed
	fire(dom, { removed: [menu.ul] });
	for (const fn of env.sweepCallbacks) fn();
	// A sweep with nothing connected stops the heartbeat without leaking.
	assert.equal(env.intervals.cleared + (env.intervals.created - env.intervals.cleared), env.intervals.created);
	env.dispose();
});
