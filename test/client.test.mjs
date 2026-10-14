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
import { createDom, makeCard, attachFiber, attachPropsFiber, makeModelSeat } from "./dom.mjs";

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
	// The enhancer's two services, then the card's own set (dsh-ancesters).
	assert.deepEqual([...bundle.inject], ["sessions", "connection", "configForms", "slots", "locale", "remote", "remote.settings"]);
	// The card/enhancer halves mount from `apply`; the budgets pin the cache
	// TTL (host default) and the failed-attempt retry ceiling.
	assert.equal(bundle.DEFAULT_REFRESH_MS, 30000);
	assert.equal(bundle.FAILURE_RETRY_MS, 3000);
});

const NOW = Date.now();

/** Default composed settings snapshot for the browser half. */
const BASE_SETTINGS = {
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
function store(byId) {
	return { list: { getSnapshot: () => ({ ids: Object.keys(byId), byId }) }, subscribe: () => () => {} };
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
 * A mutable fake configuration form, mirroring the surface the browser half
 * reads and writes through since dsh 0.2.0: `getSnapshot()` (whose `user` layer
 * answers the Overridden badge), `subscribe()` for live pushes, and `mutate(ops)`
 * as the write door — no namespace binding, no scope. `set`/`unset` are kept as
 * shorthands over the same door so the tests that drive one edit stay
 * readable, and every accepted write advances the mirrored revision the way the
 * real form's fence does.
 */
function makeForm(overrides = {}) {
	const form = {
		writes: [],
		revision: 1,
		state: {
			status: "ready",
			value: { ...BASE_SETTINGS, ...overrides },
			base: { ...BASE_SETTINGS },
			user: { ...overrides },
			revision: 1,
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
		mutate(ops) {
			const value = { ...this.state.value };
			const user = { ...this.state.user };
			let touched = 0;
			for (const op of ops) {
				const field = op.path[0];
				if (op.op === "unset") {
					this.writes.push(["unset", field]);
					delete user[field];
				} else {
					this.writes.push(["set", field, op.value]);
					value[field] = op.value;
					user[field] = op.value;
				}
				touched++;
			}
			if (touched === 0) return Promise.resolve(false);
			this.revision++;
			this.state = { ...this.state, value, user, revision: this.revision };
			for (const listener of this.listeners) listener();
			return Promise.resolve(true);
		},
		set(field, value) {
			return this.mutate([{ op: "set", path: [field], value }]);
		},
		unset(field) {
			return this.mutate([{ op: "unset", path: [field] }]);
		}
	};
	return form;
}

function setup({ sessions = store({}), settings = {}, stats = null, withSlots = false, dom = createDom(), preApply = null } = {}) {
	// Interval accounting: `created`/`cleared` track the lazy sweep heartbeat
	// (started with the first open card, stopped with the last one),
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
		}
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
		bind(ns) {
			return (key) => locale.translate(ns, key);
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

	/** The one configuration form both halves read and write through. */
	const form = makeForm(settings);
	/** Entry ids the browser half asked the form service for — the entry-id rule
	 * is what makes an aliasing card impossible to miss. */
	const served = [];

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
		configForms: {
			get(entryId) {
				served.push(entryId);
				return form;
			},
			describe() {
				return { getSnapshot: () => ({ view: { namespaces: [{ ns: "hover-info" }] } }) };
			},
			whileServed(_namespaces, register) {
				const dispose = register(new Set(["hover-info"]));
				return typeof dispose === "function" ? dispose : () => {};
			}
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
		form,
		served,
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

test("no master switch rides the configuration", () => {
	// Since dsh 0.2.0 the Plugins page answers whether this bundle runs by
	// its own row: a configuration switch saying the same thing is redundant
	// (docs/PLAN.md §40), so nothing here takes `active` at all.
	const env = setup({});
	assert.equal(env.form.state.value.active, void 0, "the served config carries no active field");
	env.dispose();
});

test("an unmount hands an already-open card back to the shell", () => {
	// The one "off" left is the bundle row being disabled, which unmounts this
	// half. A card open at that moment must not stay half-restructured.
	const env = setup({ sessions: store({ s1: { id: "s1", displayTitle: "Fix bug", cwd: "/x", updatedAt: NOW, blank: false } }) });
	const card = makeCard(env.dom, { title: "Fix bug", time: "now", statuses: [{ label: "Idle", glyph: true }] });
	attachFiber(card, { id: "s1", title: "Fix bug" });
	env.doc.body.appendChild(card);
	fire(env.dom, { added: [card] });
	assert.equal(card.getAttribute("data-hi-session"), "s1");

	env.dispose();
	const stack = card.firstElementChild;
	assert.equal(card.getAttribute("data-hi-session"), null);
	assert.equal(card.getAttribute("role"), "button");
	assert.equal(card.getAttribute("tabindex"), "0");
	assert.equal(card.style.cursor, "");
	assert.equal(
		stack.children.map((line) => (line.textContent || "").trim()).join(" | "),
		"Fix bug | now | Idle",
		"every stock line sits back where the shell put it"
	);
	assert.equal(stack.children.filter((line) => String(line.className || "").indexOf("dhi-") >= 0).length, 0);
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
	await env.form.set("showTurns", true);
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

// ── configuration card ─────────────────────────────────────────────────────
//
// Configuration stands on the bundle's own page in the Plugins list
// (`plugins.bundle.config`, keyed by the package name): clicking the plugin
// opens the form directly, with no step into the `hover-info` component. The
// page asks for the `page` shape only and hands no form of its own.

// The card is `@comecaramelos/dsh-ancesters`' `mountSettingsCard`: its
// controller, write passes and registration order are that package's own
// tests. What stays here is this plugin's descriptor — the slot and key it
// registers under, the body its one block draws, and the doors `bindBody`
// composes over the shared controller.

/**
 * Render the registered component the way the bundle page does (`{ view }`
 * only). Returns the html plus the shared controller the registration injects.
 */
function renderCard(env, { view = "page" } = {}) {
	const { renderToString } = requireCjs("react-dom/server");
	const React = requireCjs("react");
	assert.equal(env.slots.registrations.length, 1, "one slot registration");
	const { entry, component } = env.slots.registrations[0];
	const { controller } = entry.inject();
	const html = renderToString(React.createElement(component, { view }));
	return { html, controller };
}

/** The block's face — the projected fields and the four doors — off the
 * current snapshot, the way the block's `bind` composes it on every render. */
function face(controller) {
	return bundle.bindBody(controller.getSnapshot(), controller);
}

test("the card registers on the bundle's own page, keyed by the package", () => {
	const env = setup({ withSlots: true });
	assert.equal(env.slots.registrations.length, 1, "the row page is not claimed as well");
	const registered = env.slots.registrations[0];
	assert.equal(registered.entry.name, "plugins.bundle.config");
	// The bundle page is keyed by the package name — the page the list opens.
	assert.equal(registered.entry.key, "@comecaramelos/dsh-hover-information");
	assert.equal(registered.entry.locale, "hoverInfo");
	// The entry id every read and write goes through is the row id, not a
	// namespace and not the package.
	assert.deepEqual([...new Set(env.served)], ["hover-info"]);
	env.dispose();
});

test("the page shape renders every field with no card shell", () => {
	const env = setup({ withSlots: true });
	const { html } = renderCard(env);
	// The page owns the container: no collapsed header, no chevron, no card list
	// item — only the body the page wraps.
	assert.doesNotMatch(html, /dhiCard_header|dhiCard_chevron|<li /, "no shell is re-drawn inside the page");
	assert.match(html, /dhiCard_body/, "the body is what is rendered");
	const dict = env.locale.registered.find((entry) => entry.ns === "hoverInfo").dict.en;
	for (const key of ["modelProvider", "refresh", "metricTurns", "metricModel", "metricCreatedAt"]) {
		assert.ok(html.includes(dict[key]), `field copy for "${key}" is rendered`);
	}
	env.dispose();
});

test("the Overridden badge rides only the fields the user layer carries", () => {
	// Nothing stored → the page answers every field from the row config and draws
	// no badge and no reset anywhere.
	const clean = setup({ withSlots: true });
	let { html } = renderCard(clean);
	assert.equal((html.match(/dhiCard_badges/g) || []).length, 0, "an empty user layer draws no badge");
	assert.doesNotMatch(html, /dhiCard_reset/, "and no reset control");
	clean.dispose();

	// Two fields stored in the user layer → exactly two badge pairs, and the
	// badge text is the localized one. Everything else keeps a bare row.
	const dirty = setup({ withSlots: true, settings: { showContext: false, refreshMs: 5000 } });
	({ html } = renderCard(dirty));
	const dict = dirty.locale.registered.find((entry) => entry.ns === "hoverInfo").dict.en;
	assert.equal((html.match(/dhiCard_badges/g) || []).length, 2, "one badge pair per stored field");
	assert.equal((html.match(/dhiCard_reset/g) || []).length, 2, "the reset rides every badge");
	assert.equal(html.split(dict.overridden).length - 1, 2, "the badge says Overridden, twice");
	dirty.dispose();
});

test("the summary shape draws nothing: the bundle page states the package description", () => {
	const env = setup({ withSlots: true });
	assert.equal(renderCard(env, { view: "summary" }).html, "");
	env.dispose();
});

test("nothing renders before the row is served", () => {
	const env = setup({ withSlots: true });
	env.form.state = { status: "loading" };
	for (const listener of env.form.listeners) listener();
	assert.equal(renderCard(env).html, "", "an unserved entry draws nothing rather than defaults");
	env.dispose();
});

test("toggle writes go straight to the patch layer", async () => {
	const env = setup({ withSlots: true, settings: { showTurns: true } });
	const { controller } = renderCard(env);
	await face(controller).toggle("showModel", false);
	const write = env.form.writes.find((entry) => entry[0] === "set" && entry[1] === "showModel");
	assert.ok(write);
	assert.equal(write[2], false);
	assert.equal(face(controller).fields.showModel.raw, false);
	env.dispose();
});

test("invalid refreshMs drafts are rejected, valid commits land", async () => {
	const env = setup({ withSlots: true });
	const { controller } = renderCard(env);
	face(controller).editRefresh("7");
	assert.equal(face(controller).fields.refreshMs.invalid, true);
	assert.equal(await face(controller).commitRefresh(), false);
	assert.deepEqual(env.form.writes.find((entry) => entry[1] === "refreshMs"), undefined, "invalid commit does not write");
	face(controller).editRefresh("4500");
	assert.equal(face(controller).fields.refreshMs.invalid, false);
	assert.equal(await face(controller).commitRefresh(), true);
	const write = env.form.writes.find((entry) => entry[1] === "refreshMs");
	assert.equal(write[2], 4500);
	// The draft leaves with the write: the field reads the served answer again.
	assert.equal(face(controller).fields.refreshMs.raw, "4500");
	assert.equal(controller.getSnapshot().dirty, false);
	env.dispose();
});

test("resetField unsets the user override", async () => {
	const env = setup({ withSlots: true, settings: { showModel: false } });
	const { controller } = renderCard(env);
	assert.equal(face(controller).fields.showModel.overridden, true);
	await face(controller).resetField("showModel");
	const unset = env.form.writes.find((entry) => entry[0] === "unset" && entry[1] === "showModel");
	assert.ok(unset);
	assert.equal(face(controller).fields.showModel.overridden, false);
	env.dispose();
});

test("the bundle page hands no form: every edit takes the shared one", async () => {
	const env = setup({ withSlots: true });
	const { controller } = renderCard(env);
	assert.equal(await face(controller).toggle("showModel", false), true, "the write lands");
	assert.deepEqual(env.form.writes, [["set", "showModel", false]], "through the row's configuration form");
	env.dispose();
});

test("read-only mode renders without crashing", () => {
	const env = setup({ withSlots: true });
	// An answer that the entry cannot be written is what stands in for
	// read-only, so it arrives the way a Host answer would: on the served
	// snapshot, pushed — not by poking the controller's own copy.
	env.form.state = { ...env.form.state, writable: false };
	for (const listener of env.form.listeners) listener();
	const { html } = renderCard(env);
	assert.match(html, /dhiCard_/, "the body still renders");
	assert.match(html, /Configuration is read-only/, "and says why nothing can be saved");
	env.dispose();
});

test("the card mounts nothing outside the row slot: the enhancer DOM is identical with it", () => {
	// The other plane: one enhanced hover card, with and without the row card
	// mounted. The card's own sheets live in <head>; the body the enhancer
	// works on must not move by a node.
	function enhancedBody(withSlots) {
		const env = setup({ withSlots, sessions: store({ s1: { id: "s1", displayTitle: "Fix bug", cwd: "/x", updatedAt: NOW, blank: false } }) });
		const hover = makeCard(env.dom, { title: "Fix bug", time: "now", statuses: [{ label: "Idle", glyph: true }] });
		attachFiber(hover, { id: "s1", title: "Fix bug" });
		env.doc.body.appendChild(hover);
		fire(env.dom, { added: [hover] });
		const tree = JSON.stringify(serialize(env.doc.body));
		env.dispose();
		return tree;
	}
	const withCard = enhancedBody(true);
	assert.match(withCard, /dhi-/, "the enhancer did run");
	assert.equal(withCard, enhancedBody(false));
});

/** A plain tree of one DOM-stub node: tag, class, the `data-hi-*` marks, text, children. */
function serialize(node) {
	const children = Array.isArray(node.children) ? node.children : [];
	return {
		tag: node.tagName,
		className: String(node.className || ""),
		session: node.getAttribute ? node.getAttribute("data-hi-session") : null,
		text: children.length === 0 ? String(node.textContent || "") : "",
		children: children.map(serialize)
	};
}

test("the body composes two catalog blocks", () => {
	const env = setup({ withSlots: true });
	const { html } = renderCard(env);
	const dict = env.locale.registered.find((entry) => entry.ns === "hoverInfo").dict.en;
	const catalogOpen = 'class="dhiCard_catalog"';
	const firstCatalog = html.indexOf(catalogOpen);
	const secondCatalog = html.indexOf(catalogOpen, firstCatalog + 1);
	assert.notEqual(firstCatalog, -1, "catalog 1 rendered");
	assert.notEqual(secondCatalog, -1, "catalog 2 rendered");
	assert.equal(html.indexOf(catalogOpen, secondCatalog + 1), -1, "exactly two catalog blocks");
	// Catalog 1 — the composer model-selector toggle as its own catalog block,
	// two-row field shape, hint below.
	assert.ok(html.indexOf(dict.modelProvider) > firstCatalog && html.indexOf(dict.modelProvider) < secondCatalog, "model-selector title rides catalog 1");
	assert.ok(html.indexOf("Show the current selection as") > firstCatalog && html.indexOf("Off leaves the standard tooltip") < secondCatalog, "hint sits as catalog 1's field description");
	// No master switch anywhere: the dictionary carries no copy for it, so
	// nothing on the page can label a field with it.
	assert.equal("active" in dict, false, "the dictionary answers no master switch");
	assert.equal("activeHint" in dict, false, "and no hint for one");
	// Catalog 2 — the metric grid (column-major rows = ceil(13/2)) above the
	// refresh-interval field, both inside the second catalog.
	assert.ok(html.indexOf('style="grid-template-rows:repeat(7, auto)"') > secondCatalog, "column-major grid lives in catalog 2");
	assert.ok(html.indexOf(dict.refresh) > secondCatalog, "refresh field rides catalog 2");
	assert.ok(html.indexOf(dict.metricTurns) > secondCatalog, "metric titles are catalog 2 grid children");
	env.dispose();
});

test("the injected CSS lays the metric toggles out in two columns", () => {
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

test("the injected CSS composes the body as catalog blocks", () => {
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

test("model selector: a provider-paired stock value is rewritten too", () => {
	const env = setup({});
	const seat = makeModelSeat(env.dom, { withMenu: true, pairValue: true });
	// The live shape: this build renders the Model row's value as
	// `provider/model` rather than the bare model name, so the bare-name stock
	// guard would have skipped it. Restore puts exactly that pair back.
	fire(env.dom, { added: [seat.seat] });
	assert.equal(seat.cellValues[0].textContent, "OpenRouter > GPT-4o mini", "the paired stock value rewrites to the tooltip form");
	env.dispose();
	assert.equal(seat.cellValues[0].textContent, "OpenRouter/GPT-4o mini", "the shell's own rendering comes back");
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
	return env.form.set("showModelProvider", false).then(() => {
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

test("model selector: a live selection change resyncs through the trigger's store", () => {
	// The live GUI shape: the seat anchor's OWN fiber chain reaches no store
	// (`ModelSelect` renders inside the seat, not above it) — a subscription
	// read off the anchor answers nothing, and a switch that moves no DOM
	// attribute never resyncs. The trigger is the anchor whose chain answers.
	const dom = createDom();
	const seat = makeModelSeat(dom, { chain: true, storeViaTrigger: true });
	const env = setup({ dom });
	fire(env.dom, { added: [seat.seat] });
	assert.equal(seat.trigger.getAttribute("title"), "OpenRouter > GPT-4o mini", "the trigger resolves through its own return chain");
	// A live switch with no DOM record at all — only the store subscription
	// can answer it.
	seat.store.set({
		current: { provider: "anthropic", model: "claude-sonnet-4" },
		groups: [{ id: "anthropic", name: "Anthropic", models: [{ id: "claude-sonnet-4", name: "Claude Sonnet 4" }] }]
	});
	return tick().then(() => {
		assert.equal(seat.trigger.getAttribute("title"), "Anthropic > Claude Sonnet 4", "the subscription rides the live selection with no DOM change");
		env.dispose();
	});
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
	await env.form.set("showModelProvider", false);
	assert.equal(seat.trigger.getAttribute("title"), "GPT-4o mini · Medium", "off restores the stock trigger tooltip");
	assert.equal(seat.cells[0].getAttribute("title"), null, "off removes the injected cell titles");
	await env.form.set("showModelProvider", true);
	assert.equal(seat.trigger.getAttribute("title"), "OpenRouter > GPT-4o mini", "back on re-seats every title");
	assert.equal(seat.cells[0].getAttribute("title"), "OpenRouter > GPT-4o mini", "and re-seats the cells");
	env.dispose();
});

test("model selector: an unmount restores the stock selector everywhere", () => {
	const env = setup({});
	const seat = makeModelSeat(env.dom);
	fire(env.dom, { added: [seat.seat] });
	assert.equal(seat.trigger.getAttribute("title"), "OpenRouter > GPT-4o mini");
	env.dispose();
	assert.equal(seat.trigger.getAttribute("title"), "GPT-4o mini · Medium", "unmounting hands the selector back to the shell");
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
