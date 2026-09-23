/**
 * Minimal DOM + MutationObserver stubs for the browser-half tests.
 *
 * Models only the surface `lib/client.js` touches: element trees with
 * parent/child links, attributes + a plain `style` object, computed-style
 * overrides, listener registration with bubbling + stopPropagation,
 * isConnected, and MutationObserver instances that tests flush by hand.
 */

let keyCounter = 0;

class DomEvent {
	constructor(type, target) {
		this.type = type;
		this.target = target;
		this._stop = false;
	}
	stopPropagation() {
		this._stop = true;
	}
	preventDefault() {}
}

export class Element {
	constructor(tagName, doc) {
		this.tagName = String(tagName).toUpperCase();
		this.ownerDocument = doc;
		this.nodeType = 1;
		this.parentElement = null;
		this.children = [];
		this.attributes = new Map();
		this.style = {};
		this.listeners = new Map();
		this.__text = "";
		this.innerHTML = "";
		this.className = "";
		// `dataset.*` maps onto `data-*` attributes like in real DOM nodes
		// (camelCase keys become kebab-case attribute names).
		const dashed = (key) => String(key).replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
		this.dataset = new Proxy(
			{},
			{
				get: (target, key) => (typeof key === "string" ? (this.attributes.get("data-" + dashed(key)) ?? undefined) : undefined),
				set: (target, key, value) => {
					this.attributes.set("data-" + dashed(key), String(value));
					return true;
				},
				has: (target, key) => this.attributes.has("data-" + dashed(key))
			}
		);
		this.__computed = Object.create(null);
	}
	get firstElementChild() {
		return this.children[0] ?? null;
	}
	/**
	 * Like the real DOM, `textContent` of a node with element children is the
	 * concatenation of their texts — which is what the enhancer reads when it
	 * pulls a stock line's label out of `dot + span` status markup. Assigning
	 * text replaces the subtree (as in a real DOM node).
	 */
	get textContent() {
		if (this.children.length) return this.children.map((child) => child.textContent).join("");
		return this.__text ?? "";
	}
	set textContent(value) {
		for (const child of this.children) child.parentElement = null;
		this.children = [];
		this.__text = String(value);
	}
	get isConnected() {
		let node = this;
		while (node != null) {
			if (node === this.ownerDocument?.body) return true;
			node = node.parentElement;
		}
		return false;
	}
	get head() {
		return this.ownerDocument.head;
	}
	appendChild(child) {
		if (child.parentElement) child.parentElement.removeChild(child);
		child.parentElement = this;
		this.children.push(child);
		return child;
	}
	insertBefore(child, before) {
		const index = this.children.indexOf(before);
		child.parentElement?.removeChild(child);
		if (index < 0) this.children.push(child);
		else this.children.splice(index, 0, child);
		child.parentElement = this;
		return child;
	}
	removeChild(child) {
		const index = this.children.indexOf(child);
		if (index < 0) throw new Error("removeChild: not a child");
		this.children.splice(index, 1);
		child.parentElement = null;
		return child;
	}
	remove() {
		this.parentElement?.removeChild(this);
	}
	contains(other) {
		let node = other ?? null;
		while (node != null) {
			if (node === this) return true;
			node = node.parentElement;
		}
		return false;
	}
	setAttribute(name, value) {
		this.attributes.set(name, String(value));
	}
	getAttribute(name) {
		return this.attributes.has(name) ? this.attributes.get(name) : null;
	}
	hasAttribute(name) {
		return this.attributes.has(name);
	}
	removeAttribute(name) {
		this.attributes.delete(name);
	}
	/** Recursively find children matching a simple tag/class/attribute selector. */
	querySelectorAll(selector) {		const results = [];
		const self = this;
		function match(el) {
			// tag
			if (/^[a-zA-Z]+$/.test(selector)) return el.tagName === selector.toUpperCase();
			// class
			if (selector.startsWith(".")) {
				const cls = selector.slice(1);
				return el.className === cls || el.className.split(" ").includes(cls);
			}
			// attribute
			if (selector.startsWith("[")) {
				const inner = selector.slice(1, -1);
				const eq = inner.indexOf("=");
				if (eq >= 0) {
					const attr = inner.slice(0, eq).trim();
					const val = inner.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
					return el.getAttribute(attr) === val;
				}
				return el.hasAttribute(inner.trim());
			}
			return false;
		}
		function walk(node) {
			for (const child of node.children) {
				if (match(child)) results.push(child);
				walk(child);
			}
		}
		walk(this);
		return results;
	}
	querySelector(selector) {
		return this.querySelectorAll(selector)[0] ?? null;
	}
	/**
	 * `classList` view over the plain `className` string, so code that filters
	 * by token (the injected `dhi-*` wrappers) behaves like in a real DOM node.
	 */
	get classList() {
		const self = this;
		const tokens = () => (self.className ? String(self.className).split(/\s+/).filter(Boolean) : []);
		return {
			get length() {
				return tokens().length;
			},
			item: (index) => tokens()[index] ?? null,
			contains: (name) => tokens().includes(name),
			add: (name) => {
				const list = tokens();
				if (!list.includes(name)) list.push(name);
				self.className = list.join(" ");
			},
			remove: (name) => {
				self.className = tokens().filter((token) => token !== name).join(" ");
			},
			toString: () => tokens().join(" ")
		};
	}
	/** Shallow clone keeps attributes + own text; deep clone recurses children. */
	cloneNode(deep) {
		const clone = new Element(this.tagName, this.ownerDocument);
		for (const [name, value] of this.attributes) clone.attributes.set(name, value);
		Object.assign(clone.style, this.style);
		Object.assign(clone.__computed, this.__computed);
		clone.innerHTML = this.innerHTML;
		if (deep) {
			for (const child of this.children) clone.appendChild(child.cloneNode(true));
		} else {
			clone.__text = this.__text ?? "";
		}
		return clone;
	}
	addEventListener(type, listener) {
		if (!this.listeners.has(type)) this.listeners.set(type, new Set());
		this.listeners.get(type).add(listener);
	}
	removeEventListener(type, listener) {
		this.listeners.get(type)?.delete(listener);
	}
	/** Fire a DOM-ish bubbling event through the ancestor chain. */
	dispatchEvent(event) {
		let node = event.target;
		while (node != null) {
			if (!event._stop) {
				for (const listener of node.listeners.get(event.type) ?? []) {
					listener.call(node, event);
					if (event._stop) break;
				}
			}
			node = node.parentElement;
		}
		return !event._stop;
	}
}

/** Attach a fake React fiber pointer so the fiber fast-path resolves. */
export function attachFiber(element, node) {
	element["__reactFiber$test" + ++keyCounter] = { memoizedProps: { node }, child: null, sibling: null };
}

/**
 * Attach a fake React fiber carrying arbitrary memoized props — stands in
 * for the document-preview renderer's `content` prop (source text + eof).
 * `returnChain` is an optional array of ancestor fibers (hop-1, hop-2, …) that
 * the fiber's `.return` chain walks through — stands in for a real React tree
 * where `memoizedProps` (hop 0) is just the DOM props and the prop that
 * resolves identity lives on an ancestor component fiber.
 * `fiberKey` stands in for the element's React `key` (the background-job
 * menu keys its rows by job id — the fiber itself carries it).
 */
export function attachPropsFiber(element, props, returnChain, fiberKey) {
	const fiber = { memoizedProps: props, child: null, sibling: null };
	if (fiberKey !== void 0) fiber.key = String(fiberKey);
	if (Array.isArray(returnChain) && returnChain.length > 0) {
		let tail = fiber;
		for (let i = 0; i < returnChain.length; i++) {
			const next = { memoizedProps: returnChain[i].memoizedProps, child: null, sibling: null };
			tail.return = next;
			tail = next;
		}
	}
	element["__reactFiber$test" + ++keyCounter] = fiber;
}

export function createDom() {
	const observers = [];

	function createElement(tagName) {
		return new Element(tagName, doc);
	}

	function MutationObserverStub(callback) {
		const entry = { callback, targets: [] };
		observers.push(entry);
		return {
			observe(target) {
				entry.targets.push(target);
			},
			disconnect() {
				entry.targets.length = 0;
				entry.dead = true;
			},
			takeRecords() {
				return [];
			},
			entry
		};
	}

	/** Invoke every live observer callback with the given records. */
	MutationObserverStub.flush = function (records) {
		for (const entry of observers) if (!entry.dead) entry.callback(records ?? []);
	};

	const doc = {
		body: new Element("body", null),
		head: new Element("head", null),
		documentElement: new Element("html", null),
		execCommand() {
			return true;
		},
		createElement,
		querySelector(selector) {
			const match = /^style\[data-plugin-css="(.+)"\]$/.exec(selector);
			if (match === null) return null;
			for (const node of doc.head.children) {
				if (node.tagName === "STYLE" && node.attributes.get("data-plugin-css") === match[1]) return node;
			}
			return null;
		}
	};
	doc.body.parentElement = null;
	doc.documentElement.appendChild(doc.head);
	doc.documentElement.appendChild(doc.body);
	doc.body.ownerDocument = doc;
	doc.head.ownerDocument = doc;

	function getComputedStyle(element) {
		return Object.assign({ position: "static", width: "auto", display: "block", flexDirection: "row" }, element.__computed);
	}

	return {
		doc,
		Element,
		DomEvent,
		createElement,
		getComputedStyle,
		MutationObserver: MutationObserverStub,
		flush: MutationObserverStub.flush
	};
}

/**
 * A stock-shaped session card: `div > stack div (fixed, 244px) > title/time[/status]`.
 *
 * A `statuses` entry is either a plain label (a text-only line) or
 * `{ label, glyph }`, where `glyph` renders the stock `StateDot` as live DOM
 * proved it renders — a `glyph: true | "dot"` is
 * `<span data-state="done" style="width:10px;height:10px">` followed by the
 * label span (NO svg), and `glyph: "svg"` stands in for a build that draws the
 * dot as an inline `svg`.
 */
export function makeCard(dom, { title, time = "", statuses = ["Idle"] }) {
	const doc = dom.doc;
	const card = dom.createElement("div");
	card.__computed = { position: "fixed", width: "244px", display: "flex" };
	card.setAttribute("role", "button");
	card.setAttribute("tabindex", "0");
	card.style.left = "100px";
	card.style.top = "20px";
	const stack = dom.createElement("div");
	stack.__computed = { display: "flex", flexDirection: "column" };
	const titleEl = dom.createElement("div");
	titleEl.textContent = title;
	stack.appendChild(titleEl);
	if (time !== "") {
		const timeEl = dom.createElement("div");
		timeEl.textContent = time;
		stack.appendChild(timeEl);
	}
	for (const status of statuses) {
		const line = dom.createElement("div");
		if (typeof status === "string") {
			line.textContent = status;
		} else {
			if (status.glyph === "svg") {
				const svg = dom.createElement("svg");
				svg.appendChild(dom.createElement("circle"));
				line.appendChild(svg);
			} else if (status.glyph) {
				const dot = dom.createElement("span");
				dot.setAttribute("data-state", "done");
				dot.setAttribute("aria-hidden", "true");
				dot.style.width = "10px";
				dot.style.height = "10px";
				line.appendChild(dot);
			}
			const label = dom.createElement("span");
			label.textContent = status.label;
			line.appendChild(label);
		}
		stack.appendChild(line);
	}
	card.appendChild(stack);
	return card;
}

/**
 * A stock-shaped document preview: `div[data-document-preview] > header +
 * body`, mirroring `dsh-client-ui-sidebar-documentpreview`'s TextPreview
 * (path element with the absolute path in `title`, the viewer menu, a wrap
 * toggle and the reload tool). Returns the pieces the tests need.
 */
export function makePreview(dom, { path = "/home/u/proj/AGENTS.md", title = "Markdown" } = {}) {
	const doc = dom.doc;
	const root = dom.createElement("div");
	root.setAttribute("data-textpreview-state", "text");
	root.setAttribute("data-textpreview-url", "file://" + path);
	root.setAttribute("data-document-preview", "@deepseek-ai/dsh-client-ui-sidebar-documentpreview/code");
	const header = dom.createElement("div");
	const pathEl = dom.createElement("div");
	pathEl.setAttribute("data-textpreview-path", "true");
	pathEl.setAttribute("title", path);
	const pathText = dom.createElement("span");
	const directory = path.slice(0, Math.max(path.lastIndexOf("/") + 1, 0));
	const name = path.slice(directory.length);
	if (directory !== "") {
		const directoryEl = dom.createElement("span");
		directoryEl.textContent = directory;
		pathText.appendChild(directoryEl);
	}
	const nameEl = dom.createElement("span");
	nameEl.textContent = name;
	pathText.appendChild(nameEl);
	pathEl.appendChild(pathText);
	header.appendChild(pathEl);
	const menuWrap = dom.createElement("span");
	const menu = dom.createElement("button");
	menu.setAttribute("data-document-viewer-menu", "true");
	menu.textContent = title;
	menuWrap.appendChild(menu);
	header.appendChild(menuWrap);
	const reload = dom.createElement("button");
	reload.setAttribute("data-textpreview-tool", "reload");
	reload.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16"></svg>';
	header.appendChild(reload);
	root.appendChild(header);
	const body = dom.createElement("div");
	body.setAttribute("data-textpreview-body", "true");
	root.appendChild(body);
	return { root, header, pathEl, body, reload };
}

/**
 * The composer's stock model selector (docs/PLAN.md §33): the named seat
 * anchor (`div[data-slot="conversation.input.model"]`) with the
 * `button[class$="_trigger"]` inside it, whose `title` is the shell-composed
 * `model · effort`.
 *
 * - `withFiber` (default) stands the `ModelSelect` component fiber in on both
 *   the anchor and the trigger — its `directory` store answers
 *   `getSnapshot()` with `{ current: {provider, model}, groups }` and lets a
 *   test flip the selection through `store.set(next)`;
 * - `chain` (with `withFiber`) stands the fiber in the way the live React
 *   tree does: hop 0 carries only DOM props and `directory` lives on a
 *   component fiber up the `.return` chain — and the menu-cell fibers' return
 *   chains reach nothing carrying `directory` (the portal's real shape is
 * *why* the menu cells used to resolve only off the DOM source). This is the
 *   shape that reproduces the live bug; the fiber source on the seat's return
 *   chain still answers for the trigger.
 * - `withMenu` appends the body-portal root menu: the two
 *   `button[class$="_cell"][role="menuitem"]` cells; `openList` (default true)
 *   also mounts the model-list section with the checked option — the DOM
 *   source's only DOM-visible signal — while `openList: false` stands the
 *   common closed-list (root-pane) state with no DOM source at all.
 */
export function makeModelSeat(dom, { provider = "openrouter", model = "gpt-4o-mini", providerName = "OpenRouter", modelName = "GPT-4o mini", effort = "Medium", withFiber = true, chain = false, withMenu = false, openList = true } = {}) {
	const doc = dom.doc;
	const seat = dom.createElement("div");
	seat.setAttribute("data-slot", "conversation.input.model");
	const trigger = dom.createElement("button");
	trigger.className = "_7KE1Ra_trigger";
	trigger.setAttribute("title", modelName + " · " + effort);
	seat.appendChild(trigger);
	doc.body.appendChild(seat);
	let store = null;
	if (withFiber) {
		store = {
			subscribers: [],
			value: { current: { provider: provider, model: model }, groups: [{ id: provider, name: providerName, models: [{ id: model, name: modelName }] }] },
			getSnapshot() {
				return this.value;
			},
			subscribe(listener) {
				this.subscribers.push(listener);
				return () => {
					this.subscribers = this.subscribers.filter((fn) => fn !== listener);
				};
			},
			set(next) {
				this.value = next;
				for (const listener of this.subscribers) listener();
			}
		};
		if (chain) {
			// Live React shape: hop 0 is DOM props; `directory` lives on a
			// component fiber up the `.return` chain. Both the seat and the
			// trigger reach the store through the chain (so the fiber source
			// answers for them), exactly as a live composer does.
			attachPropsFiber(seat, { "data-slot": "conversation.input.model" }, [{ memoizedProps: {} }, { memoizedProps: { directory: store } }]);
			attachPropsFiber(trigger, { className: "_7KE1Ra_trigger", title: modelName + " · " + effort }, [{ memoizedProps: {} }, { memoizedProps: { directory: store } }]);
		} else {
			attachPropsFiber(seat, { directory: store });
			attachPropsFiber(trigger, { directory: store });
		}
	}
	const out = { seat: seat, trigger: trigger, store: store, menu: null, cells: [], cellValues: [], option: null };
	if (withMenu) {
		const menu = dom.createElement("div");
		menu.className = "_7KE1Ra_menu";
		menu.setAttribute("role", "menu");
		for (const label of ["Model", "Effort"]) {
			const cell = dom.createElement("button");
			cell.className = "_7KE1Ra_cell";
			cell.setAttribute("role", "menuitem");
			// Stock shape: a row label + the shell's `cellValue` span carrying
			// the bare model name (the provider is never rendered here).
			const labelEl = dom.createElement("span");
			labelEl.className = "_7KE1Ra_cellLabel";
			labelEl.textContent = label;
			cell.appendChild(labelEl);
			const valueEl = dom.createElement("span");
			valueEl.className = "_7KE1Ra_cellValue";
			valueEl.textContent = label === "Model" ? modelName : "Medium";
			cell.appendChild(valueEl);
			menu.appendChild(cell);
			out.cells.push(cell);
			out.cellValues.push(valueEl);
		}
		if (openList) {
			// The model-list pane open (the DOM source's only DOM-visible
			// signal): the checked option inside its provider-grouped section.
			const section = dom.createElement("section");
			section.setAttribute("role", "group");
			const groupTitle = dom.createElement("div");
			groupTitle.className = "_7KE1Ra_groupTitle";
			groupTitle.textContent = providerName;
			section.appendChild(groupTitle);
			const option = dom.createElement("button");
			option.className = "_7KE1Ra_option";
			option.setAttribute("role", "menuitemradio");
			option.setAttribute("aria-checked", "true");
			const nameEl = dom.createElement("span");
			nameEl.className = "_7KE1Ra_modelName";
			nameEl.textContent = modelName;
			option.appendChild(nameEl);
			section.appendChild(option);
			menu.appendChild(section);
			out.option = option;
		}
		doc.body.appendChild(menu);
		if (store !== null) {
			if (chain) {
				// Live reality: a portal cell's own fiber return-chain does NOT
				// carry the `directory` props (the live bug this reproduces) —
				// the fiber source on a cell must miss, and resolution rides
				// the composer (seat) source instead.
				for (const cell of out.cells) attachPropsFiber(cell, { className: "_7KE1Ra_cell", role: "menuitem" }, [{ memoizedProps: {} }]);
			} else {
				for (const cell of out.cells) attachPropsFiber(cell, { directory: store });
			}
		}
		out.menu = menu;
	}
	return out;
}

/**
 * A stock-shaped `JobListAction` menu: `div > ul[aria-label] > li` rows
 * shaped like the shell renders them (state dot + kind chip + label +
 * status + duration). Each row's fiber carries the React key the shell
 * gives rows (the background-job id), and `sessionId` rides an ancestor
 * fiber — the fast-path every identity resolution uses.
 *
 * Rows without their own `id` omit the fiber key (the shell's keys are
 * only an optimization there too).
 */
export function makeJobMenu(dom, { rows = [], sessionId = undefined, ariaLabel = "Background jobs" } = {}) {
	const doc = dom.doc;
	const root = dom.createElement("div");
	root.className = "_job_menuRoot";
	const ul = dom.createElement("ul");
	ul.setAttribute("aria-label", ariaLabel);
	root.appendChild(ul);
	for (const row of rows) {
		const li = dom.createElement("li");
		li.className = "_job_row" + (row.live === false ? " _job_rowSettled" : "");
		const dot = dom.createElement("span");
		dot.setAttribute("data-state", row.live === false ? "done" : row.status === "stopping" ? "warning" : "ongoing");
		dot.style.width = "10px";
		dot.style.height = "10px";
		const kind = dom.createElement("span");
		kind.textContent = "bash";
		const label = dom.createElement("span");
		label.textContent = row.label ?? "exec sleep 10";
		const status = dom.createElement("span");
		status.textContent = row.live === false ? "completed" : row.status === "stopping" ? "stopping" : "running";
		const duration = dom.createElement("span");
		duration.textContent = "1m 40s";
		for (const span of [dot, kind, label, status, duration]) li.appendChild(span);
		if (row.id !== undefined && row.id !== null) attachPropsFiber(li, { className: li.className }, undefined, row.id);
		ul.appendChild(li);
	}
	if (sessionId !== undefined) attachPropsFiber(ul, { className: "_job_menu" }, [{ memoizedProps: {} }, { memoizedProps: { sessionId } }]);
	return { root, ul };
}
