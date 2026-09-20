// Browser half of @comecaramelos/dsh-hover-information.
//
// Three cooperating pieces, all mounted from `apply(ctx)`:
//
// 1. The hover-card enhancer. Session identity resolves from the live browser
//    `sessions` store (fiber fast-path first, DOM title+time fallback
//    second). Cards the plugin resolves grow two corner icons (copy session
//    id / copy workspace path; the stock whole-card copy stays neutralized
//    only on those cards) and a metrics block fed by the host
//    `hoverInfo/stats` remote over the generic HTTP envelope, cached per
//    session with the `refreshMs` TTL.
//
// 2. The document-preview enhancer. The stock sidebar file preview's header
//    grows two tools — copy file content / copy file path — keyed off the
//    shell's stable `data-textpreview-path` / `data-document-preview`
//    anchors; content sources from the renderer's `content` fiber prop
//    (exact source, byte-for-byte) with a `workspaceFiles/readAll` fallback
//    for previews that have not loaded past eof (docs/PLAN.md §19).
//
// 3. The Settings → Plugins card: the `active` master switch, the `refreshMs`
//    TTL, and one switch per metric row. Booleans write straight to the
//    user layer (idempotent; the host always serves every metric, so caches
//    never key off the toggles); refreshMs stages its text draft.
//
// Detection stays structural (portal in body, fixed, 244 px, column stack):
// nothing depends on hashed CSS-module class names, and every failure path
// leaves the stock UI untouched (fail-open).
window.__ModuleLoader__.load({
	id: "@comecaramelos/dsh-hover-information",
	factory: function (require) {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		var react = require("react");
		var reactJsx = require("react/jsx-runtime");
		var clientStore = require("@deepseek-ai/dsh-client-store");
		// Shell primitives (`Switch` is the stock settings toggle, self-styled
		// by the shell CSS — never reference its hashed class names).
		var primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		var Switch = primitives && primitives.Switch;

		/** Cordis browser services this half reads. */
		var inject = ["sessions", "connection", "locale", "settingsScope", "slots"];

		/** Settings namespace served by the host half; also the card slot key. */
		var SETTINGS_NS = "hover-info";
		/** Locale namespace owning this plugin's dictionary. */
		var LOCALE_NS = "hoverInfo";
		/** Workspace-browser locale namespace (source of the stock time labels). */
		var WORKSPACE_NS = "workspace";

		/** Metric row spec: `field` is the settings key; format by key. */
		var METRICS = [
			{ field: "showTurns", key: "turns", labelKey: "metricTurns" },
			{ field: "showSteps", key: "steps", labelKey: "metricSteps" },
			{ field: "showTokensIn", key: "tokensIn", labelKey: "metricTokensIn" },
			{ field: "showTokensOut", key: "tokensOut", labelKey: "metricTokensOut" },
			{ field: "showCacheRead", key: "cacheRead", labelKey: "metricCacheRead" },
			{ field: "showCompactions", key: "compactions", labelKey: "metricCompactions" },
			{ field: "showToolCalls", key: "toolCalls", labelKey: "metricToolCalls" },
			{ field: "showActiveTime", key: "activeTime", labelKey: "metricActiveTime" },
			{ field: "showContext", key: "context", labelKey: "metricContext" },
			{ field: "showSubagents", key: "subagents", labelKey: "metricSubagents" },
			{ field: "showModel", key: "model", labelKey: "metricModel" },
			{ field: "showCreatedAt", key: "createdAt", labelKey: "metricCreatedAt" }
		];

		var DICTIONARY = {
			en: {
				title: "Hover information",
				description: "Extra lines on session hover cards.",
				active: "Active",
				activeHint: "Show the extra lines on session hover cards. Off leaves the stock card untouched.",
				refresh: "Refresh interval (ms)",
				refreshHint: "How often open cards refresh their metrics (1000-60000 ms).",
				refreshInvalid: "Enter a whole number between 1000 and 60000.",
				overridden: "Overridden",
				reset: "Reset to default",
				readOnly: "Settings are read-only in this deployment.",
				expand: "Expand",
				collapse: "Collapse",
				copySessionId: "Copy session ID",
				copyWorkspacePath: "Copy workspace path",
				copyFileContent: "Copy file content",
				copyFilePath: "Copy file path",
				metricTurns: "Turns",
				metricSteps: "Steps",
				metricTokensIn: "Sent",
				metricTokensOut: "Received",
				metricCacheRead: "Cache",
				metricCompactions: "Compactions",
				metricToolCalls: "Tool calls",
				metricActiveTime: "Active",
				metricContext: "Context",
				metricSubagents: "Subagents",
				metricModel: "Model",
				metricCreatedAt: "Created"
			}
		};

		/** Structural fingerprint: the stock hover card is exactly this wide. */
		var HOVER_CARD_WIDTH = 244;
		/**
		 * Structural anchors for the stock document preview: stable shell
		 * data attributes, never the hashed `*Header`/`*tool` CSS-module
		 * classes (same rule as the hover card, §13). `data-document-preview`
		 * marks the preview root (value = the active renderer id);
		 * `data-textpreview-path` marks the header path element, whose
		 * `title` carries the absolute display path.
		 */
		var PREVIEW_ROOT_ATTR = "data-document-preview";
		var PREVIEW_PATH_ATTR = "data-textpreview-path";
		/** How long the check mark replaces the icon after a copy. */
		var COPY_FEEDBACK_MS = 1300;
		/** Default cache TTL; mirrors the host settings default. */
		var DEFAULT_REFRESH_MS = 30000;
		/**
		 * Ceiling on how long a *failed* live-stats attempt suppresses the
		 * next one. A live miss is usually transient — the session is not
		 * loaded in the host yet, or the gateway is still warming up — so
		 * those attempts retry on this clock instead of the full TTL; a
		 * card opened during a cold start would otherwise stay blank for
		 * `refreshMs` (30 s by default) although the answer is one round
		 * trip away. A settled *hit* keeps the full TTL.
		 */
		var FAILURE_RETRY_MS = 3000;
		var CSS_TAG = "@comecaramelos/dsh-hover-information/hoverEnhancer.css";

		/**
		 * The stock card's surface is fixed-dark in BOTH themes
		 * (`--dsw-hovercard-bg: #2C2C2E`, a literal with no theme variant —
		 * a popover-style inverted surface, like its white title), so the
		 * injected overlay must NOT resolve theme aliases: on the light
		 * theme an alias label is a dark value and would sit invisible on
		 * the dark card. Fixed palette only (the semantic context-bar fills
		 * are the single exception; they read identically on either theme).
		 */
		var CSS =
			".dhi-bar{display:flex;gap:4px;flex:none;align-items:center}" +
			".dhi-btn{cursor:pointer;width:22px;height:20px;color:#adb2b8;background:0 0;border:none;border-radius:4px;justify-content:center;align-items:center;padding:0;display:inline-flex}" +
			".dhi-btn:hover{color:#f6f7f8;background:rgb(255 255 255 / 10%)}" +
			".dhi-btn svg{width:13px;height:13px;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;fill:none}" +
			// Two COLUMNS of rows, auto-placed one metric per cell, so the
			// tracks must be equal (minmax(0,1fr) twice). `1fr auto` — a
			// leftover from the single label/value row model — left the label
			// column absorbing every leftover px while the value column only
			// sized to max-content, so the left column read visibly wider
			// than the right for most metric sets.
			".dhi-metrics{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px 12px;margin-top:8px;padding-top:8px;border-top:.5px solid rgb(255 255 255 / 12%);font-size:12px;line-height:16px;pointer-events:none;max-height:176px;overflow:hidden}" +
			".dhi-k{color:#adb2b8;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
			".dhi-v{color:#cfd3d6;flex:none;padding-left:8px;text-align:right}" +
			".dhi-mrow{min-width:0;justify-content:space-between;align-items:baseline;gap:6px;display:flex}" +
			".dhi-mrow[data-hi-metric=\"createdAt\"]{grid-column:1 / -1}" +
			".dhi-mrow[data-hi-metric=\"model\"]{grid-column:1 / -1}" +
			".dhi-mrow-context{grid-column:1 / -1;min-width:0;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 10px}" +
			".dhi-ctxbar{grid-column:1 / -1;height:4px;border-radius:2px;background:rgb(255 255 255 / 10%);overflow:hidden;margin-top:2px}" +
			".dhi-ctxfill{height:4px;border-radius:2px;background:#3fb950}" +
			".dhi-ctxfill-warn{background:#d29922}" +
			".dhi-ctxfill-error{background:#f85149}" +
			".dhi-twrap{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12px;line-height:16px}" +
			// The title line is located structurally (the first stock line) and
			// marked — never matched by its hash-prefixed `*_hoverTitle` class.
			// The two-attribute selector outweighs that class rule no matter the
			// stylesheet order.
			"[data-hi-session] [data-hi-title]{font-size:16px}" +
			".dhi-lead{display:inline-flex;align-items:center;gap:6px;min-width:0;overflow:hidden}" +
			".dhi-tools{gap:4px;flex:none;align-items:center;display:inline-flex}" +
			".dhi-tool{width:28px;height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:28px;flex:none;justify-content:center;align-items:center;padding:6px;line-height:1;display:inline-flex}" +
			".dhi-tool svg{width:15px;height:15px;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;fill:none}" +
			".dhi-tool:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}";

		var ICONS = {
			id: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>',
			path: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>',
			copy: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
			done: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>'
		};

		function noop() {}

		function ensureCss(doc) {
			if (doc.querySelector("style[data-plugin-css=" + JSON.stringify(CSS_TAG) + "]") !== null) return noop;
			var tag = doc.createElement("style");
			tag.dataset.plugin = "@comecaramelos/dsh-hover-information";
			tag.dataset.pluginCss = CSS_TAG;
			tag.textContent = CSS;
			doc.head.appendChild(tag);
			return function () {
				tag.remove();
			};
		}

		// ── metric formatting (docs/PLAN.md §4) ────────────────────────────
		/** Compact token count: 1200 → "1.2k", 3400000 → "3.4M", 950 → "950". */
		function formatTokens(value) {
			var n = Number(value);
			if (!Number.isFinite(n) || n <= 0) return "0";
			if (n < 1000) return String(Math.round(n));
			var units = [
				[1e12, "T"],
				[1e9, "B"],
				[1e6, "M"],
				[1e3, "k"]
			];
			for (var i = 0; i < units.length; i++) {
				var scale = units[i][0];
				if (n >= scale) {
					var scaled = n / scale;
					return (scaled >= 100 ? String(Math.round(scaled)) : String(Math.round(scaled * 10) / 10)) + units[i][1];
				}
			}
			return String(Math.round(n));
		}

		/** Compact duration from milliseconds: "4m 12s", "1h 03m", "52s". */
		function formatDuration(ms) {
			var total = Math.max(0, Math.round(Number(ms) || 0) / 1000);
			var hours = Math.floor(total / 3600);
			var minutes = Math.floor((total % 3600) / 60);
			var seconds = Math.floor(total % 60);
			function pad(n) {
				return (n < 10 ? "0" : "") + n;
			}
			if (hours > 0) return hours + "h " + pad(minutes) + "m";
			if (minutes > 0) return minutes + "m " + pad(seconds) + "s";
			return seconds + "s";
		}

		/** Short absolute date for the Created row: "2026-09-01". */
		function formatDate(epochMs) {
			var d = new Date(Number(epochMs) || 0);
			var month = d.getMonth() + 1;
			var day = d.getDate();
			return d.getFullYear() + "-" + (month < 10 ? "0" : "") + month + "-" + (day < 10 ? "0" : "") + day;
		}

		/**
		 * Resolve one row's rendered value from a stats view; null when the
		 * row has nothing to show yet (omit the row — never show a fake zero
		 * for a metric the fold has not sampled).
		 */
		function rowValues(row, view) {
			if (!view) return null;
			switch (row.key) {
				case "turns":
					return Number(view.turns) ? { value: String(view.turns) } : null;
				case "steps":
					return Number(view.steps) ? { value: String(view.steps) } : null;
				case "toolCalls":
					return Number(view.toolCalls) ? { value: String(view.toolCalls) } : null;
				case "compactions":
					return Number(view.compactions) ? { value: String(view.compactions) } : null;
				case "tokensIn":
					return Number(view.tokensIn) ? { value: formatTokens(view.tokensIn) } : null;
				case "tokensOut":
					return Number(view.tokensOut) ? { value: formatTokens(view.tokensOut) } : null;
				case "cacheRead":
					return Number(view.cacheRead) ? { value: formatTokens(view.cacheRead) } : null;
				case "activeTime": {
					var total = (Number(view.llmMs) || 0) + (Number(view.toolMs) || 0);
					return total > 0 ? { value: formatDuration(total) } : null;
				}
				case "subagents": {
					var spawned = Number(view.subagentsSpawned) || 0;
					var running = Number(view.subagentsRunning) || 0;
					if (spawned === 0 && running === 0) return null;
					return { value: running > 0 ? spawned + " (" + running + " running)" : String(spawned) };
				}
				case "model": {
					var model = view.lastRequest && typeof view.lastRequest.model === "string" ? view.lastRequest.model : null;
					return model ? { value: model } : null;
				}
				case "createdAt": {
					var created = Number(view.createdAt) || 0;
					return created > 0 ? { value: formatDate(created) } : null;
				}
				case "context": {
					var sample = view.lastContext;
					if (!sample || !Number(sample.tokens)) return null;
					var tokens = formatTokens(sample.tokens);
					var request = view.lastRequest;
					var window = request && typeof request.contextWindow === "number" && request.contextWindow > 0 ? request.contextWindow : null;
					if (window === null) return { value: tokens + " tokens" };
					var percent = Math.min(100, Math.round((1000 * Number(sample.tokens)) / window) / 10);
					var tone = percent < 70 ? "dhi-ctxfill" : percent < 90 ? "dhi-ctxfill dhi-ctxfill-warn" : "dhi-ctxfill dhi-ctxfill-error";
					return { value: tokens + " / " + formatTokens(window) + " · " + percent + "%", bar: { percent: percent, tone: tone } };
				}
				default:
					return null;
			}
		}

		// ── settings card (Settings → Plugins) ─────────────────────────────
		/** Field specs: bool rows write immediately; refreshMs stages. */
		var CARD_FIELDS = [{ field: "active", kind: "bool" }];
		for (var mi = 0; mi < METRICS.length; mi++) CARD_FIELDS.push({ field: METRICS[mi].field, kind: "bool", labelKey: METRICS[mi].labelKey });
		CARD_FIELDS.push({ field: "refreshMs", kind: "int", min: 1000, max: 60000 });

		function fieldSpec(name) {
			for (var i = 0; i < CARD_FIELDS.length; i++) if (CARD_FIELDS[i].field === name) return CARD_FIELDS[i];
			return null;
		}

		function parseRefreshMs(text, spec) {
			var trimmed = String(text).trim();
			if (trimmed === "") return null;
			var parsed = Number(trimmed);
			if (!Number.isInteger(parsed) || parsed < spec.min || parsed > spec.max) return null;
			return parsed;
		}

		var CARD_CSS = {
			card: "dhiCard_card",
			cardOpen: "dhiCard_cardOpen",
			header: "dhiCard_header",
			headText: "dhiCard_headText",
			nameRow: "dhiCard_nameRow",
			name: "dhiCard_name",
			badge: "dhiCard_badge",
			desc: "dhiCard_desc",
			chevron: "dhiCard_chevron",
			chevronOpen: "dhiCard_chevronOpen",
			body: "dhiCard_body",
			field: "dhiCard_field",
			fieldHead: "dhiCard_fieldHead",
			label: "dhiCard_label",
			badges: "dhiCard_badges",
			reset: "dhiCard_reset",
			input: "dhiCard_input",
			inputInvalid: "dhiCard_inputInvalid",
			invalid: "dhiCard_invalid",
			hint: "dhiCard_hint",
			checkRow: "dhiCard_checkRow",
			readOnly: "dhiCard_readOnly"
		};
		var CARD_CSS_TEXT =
			`.${CARD_CSS.card}{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);border-radius:16px;list-style:none;transition:border-color .16s,background .16s}` +
			`.${CARD_CSS.card}:hover{border-color:var(--dsw-alias-label-dimmed)}` +
			`.${CARD_CSS.cardOpen}{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}` +
			`.${CARD_CSS.header}{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}` +
			`.${CARD_CSS.header}:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}` +
			`.${CARD_CSS.headText}{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}` +
			`.${CARD_CSS.nameRow}{align-items:center;gap:8px;min-width:0;display:flex}` +
			`.${CARD_CSS.name}{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}` +
			`.${CARD_CSS.badge}{color:var(--dsw-alias-label-secondary);border:.5px solid var(--dsw-alias-border-l4);border-radius:999px;font-size:11px;padding:1px 8px}` +
			`.${CARD_CSS.desc}{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}` +
			`.${CARD_CSS.chevron}{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}` +
			`.${CARD_CSS.chevronOpen}{transform:rotate(180deg)}` +
			`.${CARD_CSS.body}{border-top:.5px solid var(--dsw-alias-border-l2);flex-direction:column;gap:8px;margin:0 16px;padding:12px 0;display:flex}` +
			`.${CARD_CSS.field}{display:grid;gap:5px;max-width:420px}` +
			`.${CARD_CSS.fieldHead}{align-items:center;gap:8px;display:flex}` +
			`.${CARD_CSS.label}{color:var(--dsw-alias-label-secondary);font-size:12px;flex:1;min-width:0}` +
			`.${CARD_CSS.badges}{align-items:center;gap:8px;display:inline-flex}` +
			`.${CARD_CSS.reset}{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;font-size:12px;padding:0}` +
			`.${CARD_CSS.reset}:hover:not(:disabled){color:var(--dsw-alias-label-primary)}` +
			`.${CARD_CSS.input}{color:var(--dsw-alias-label-primary);border:.5px solid var(--dsw-alias-border-l4);border-radius:6px;background:var(--dsw-alias-bg-l2,transparent);font:inherit;font-size:13px;padding:5px 8px;max-width:140px}` +
			`.${CARD_CSS.input}:disabled{cursor:default;opacity:.5}` +
			`.${CARD_CSS.inputInvalid}{border-color:var(--dsw-alias-label-error)}` +
			`.${CARD_CSS.invalid}{color:var(--dsw-alias-label-error);margin:0;font-size:12px}` +
			`.${CARD_CSS.hint}{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}` +
			`.${CARD_CSS.checkRow}{align-items:center;gap:8px;max-width:420px;display:flex}` +
			`.${CARD_CSS.checkRow} .${CARD_CSS.label}{cursor:pointer}` +
			`.${CARD_CSS.checkRow} input[type="checkbox"]{cursor:pointer}` +
			`.${CARD_CSS.readOnly}{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px}`;
		var CARD_CSS_TAG = "@comecaramelos/dsh-hover-information/HoverInformationCard.module.css";
		var cardCssInstalled = false;
		function ensureCardCss(doc) {
			if (cardCssInstalled) return;
			if (doc.querySelector('style[data-plugin-css="' + CARD_CSS_TAG + '"]') !== null) {
				cardCssInstalled = true;
				return;
			}
			var tag = doc.createElement("style");
			tag.dataset.plugin = "@comecaramelos/dsh-hover-information";
			tag.dataset.pluginCss = CARD_CSS_TAG;
			tag.textContent = CARD_CSS_TEXT;
			doc.head.appendChild(tag);
			cardCssInstalled = true;
		}

		/** Chevron matching the shell's IconChevronDownOutline14 primitive. */
		const CHEVRON_PATH = "M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.3623 7.35977 8.13383L10.5762 5.07617L11 4.65137L11.8486 5.5Z";

		/**
		 * Card controller: publishes { available, writable, fields } from the
		 * bound settings scope plus local drafts for the refreshMs field.
		 * Booleans write straight through; invalid int drafts stay staged.
		 */
		var HoverInformationCardController = class {
			constructor(scope) {
				this.scope = scope;
				this.staged = new Map();
				this.disposed = false;
				this.store = clientStore.createSnapshotStore(this.projection());
				this.unsubscribe = scope.subscribe(() => {
					if (!this.disposed) this.publish();
				});
			}
			storedIn(snapshot, field) {
				return snapshot.user != null && Object.prototype.hasOwnProperty.call(snapshot.user, field);
			}
			fieldProjection(field, snapshot) {
				var spec = fieldSpec(field);
				var value = snapshot.value != null ? snapshot.value[field] : void 0;
				var staged = this.staged.get(field);
				var raw;
				var invalid = false;
				if (spec !== null && spec.kind === "int") {
					if (staged !== void 0) {
						raw = staged.text;
						invalid = staged.text.trim() !== "" && parseRefreshMs(staged.text, spec) === null;
					} else raw = typeof value === "number" ? String(value) : "";
				} else {
					raw = value === true;
				}
				return { raw: raw, overridden: this.storedIn(snapshot, field), invalid: invalid };
			}
			projection() {
				var snapshot = this.scope.getSnapshot();
				var ready = snapshot.status === "ready" && snapshot.value !== void 0;
				var fields = {};
				for (var i = 0; i < CARD_FIELDS.length; i++) fields[CARD_FIELDS[i].field] = this.fieldProjection(CARD_FIELDS[i].field, snapshot);
				return { available: ready, writable: snapshot.writable === true, fields: fields };
			}
			publish() {
				if (!this.disposed) this.store.set(this.projection());
			}
			/** Write one boolean straight to the user layer. */
			toggle(field, checked) {
				var spec = fieldSpec(field);
				if (spec === null || spec.kind !== "bool") return Promise.resolve(false);
				var self = this;
				return this.scope.set(field, !!checked).then(
					function () {
						self.publish();
						return true;
					},
					function () {
						self.publish();
						return false;
					}
				);
			}
			/** Stage the refreshMs draft text. */
			editRefresh(text) {
				this.staged.set("refreshMs", { text: String(text) });
				this.publish();
			}
			/** Commit the staged refreshMs when valid; returns whether it landed. */
			commitRefresh() {
				var staged = this.staged.get("refreshMs");
				if (staged === void 0) return Promise.resolve(false);
				var parsed = parseRefreshMs(staged.text, fieldSpec("refreshMs"));
				if (parsed === null) {
					this.publish();
					return Promise.resolve(false);
				}
				var current = this.scope.getSnapshot().value;
				if (current !== void 0 && current.refreshMs === parsed) {
					this.staged.delete("refreshMs");
					this.publish();
					return Promise.resolve(true);
				}
				var self = this;
				return this.scope.set("refreshMs", parsed).then(
					function () {
						var snapshot = self.scope.getSnapshot();
						var landed = snapshot.user != null && snapshot.user.refreshMs === parsed;
						if (landed) self.staged.delete("refreshMs");
						self.publish();
						return landed;
					},
					function () {
						return false;
					}
				);
			}
			/** Clear one field's user-layer override. */
			resetField(field) {
				var self = this;
				return this.scope.unset(field).then(
					function () {
						self.staged.delete(field);
						self.publish();
						return true;
					},
					function () {
						return false;
					}
				);
			}
			inject() {
				var self = this;
				return {
					hooks: { hoverInformationCard: this.store },
					toggle: function (field, checked) {
						return self.toggle(field, checked);
					},
					editRefresh: function (text) {
						self.editRefresh(text);
					},
					commitRefresh: function () {
						return self.commitRefresh();
					},
					resetField: function (field) {
						return self.resetField(field);
					}
				};
			}
			dispose() {
				this.disposed = true;
				this.unsubscribe();
			}
		};

		/**
		 * One toggle row with Overridden badge + reset control. The toggle is
		 * the shell's `Switch` primitive when resolvable (styles and hashed
		 * class names owned by the shell); the row falls back to a plain
		 * checkbox only if the primitive is absent.
		 */
		function FieldRow(props) {
			var field = props.field;
			var checked = !!(field && field.raw === true);
			return (0, reactJsx.jsxs)("div", {
				className: CARD_CSS.checkRow,
				children: [
					Switch
						? (0, reactJsx.jsx)(Switch, {
								checked: checked,
								label: props.label,
								disabled: !props.writable,
								onChange: function (next) {
									props.onToggle(next);
								}
							})
						: (0, reactJsx.jsx)("input", {
								type: "checkbox",
								checked: checked,
								disabled: !props.writable,
								"aria-label": props.label,
								onChange: function (event) {
									props.onToggle(event.target.checked);
								}
							}),
					(0, reactJsx.jsx)("span", {
						id: props.id,
						className: CARD_CSS.label,
						onClick: function () {
							if (props.writable) props.onToggle(!checked);
						},
						children: props.label
					}),
					field && field.overridden ? (0, reactJsx.jsx)("span", { className: CARD_CSS.badge, children: props.t("overridden") }) : null,
					field && field.overridden
						? (0, reactJsx.jsx)("button", {
								type: "button",
								className: CARD_CSS.reset,
								disabled: !props.writable,
								onClick: function () {
									props.onReset();
								},
								children: props.t("reset")
							})
						: null
				]
			});
		}

		/**
		 * The card component: collapsible (closed by default), renders
		 * nothing until the namespace is served.
		 */
		function HoverInformationCard(props) {
			var t = props.t;
			var state = props.useHoverInformationCard((snapshot) => snapshot);
			var openState = react.useState(false);
			var open = openState[0];
			var setOpen = openState[1];
			var bodyId = react.useId();
			var idSeed = react.useId();
			if (!state.available) return null;
			var disabled = !state.writable;
			var fields = state.fields;
			return (0, reactJsx.jsxs)("li", {
				className: CARD_CSS.card + (open ? " " + CARD_CSS.cardOpen : ""),
				children: [
					(0, reactJsx.jsxs)("button", {
						type: "button",
						className: CARD_CSS.header,
						"aria-expanded": open,
						"aria-label": t(open ? "collapse" : "expand") + ": " + t("title"),
						"aria-controls": bodyId,
						onClick: function () {
							setOpen(!open);
						},
						children: [
							(0, reactJsx.jsxs)("span", {
								className: CARD_CSS.headText,
								children: [
									(0, reactJsx.jsx)("span", { className: CARD_CSS.name, children: t("title") }),
									(0, reactJsx.jsx)("span", { className: CARD_CSS.desc, children: t("description") })
								]
							}),
							(0, reactJsx.jsx)("svg", {
								width: 14,
								height: 14,
								className: CARD_CSS.chevron + (open ? " " + CARD_CSS.chevronOpen : ""),
								viewBox: "0 0 14 14",
								fill: "none",
								xmlns: "http://www.w3.org/2000/svg",
								children: (0, reactJsx.jsx)("path", { d: CHEVRON_PATH, fill: "currentColor" })
							})
						]
					}),
					open
						? (0, reactJsx.jsxs)("div", {
								id: bodyId,
								className: CARD_CSS.body,
								children: [
									state.writable
										? null
										: (0, reactJsx.jsx)("p", { className: CARD_CSS.readOnly, role: "status", children: t("readOnly") }),
									(0, reactJsx.jsx)(FieldRow, {
										id: idSeed + "-active",
										label: t("active"),
										field: fields.active,
										writable: !disabled,
										t: t,
										onToggle: function (checked) {
											props.toggle("active", checked);
										},
										onReset: function () {
											props.resetField("active");
										}
									}),
									(0, reactJsx.jsx)("span", { className: CARD_CSS.hint, children: t("activeHint") }),
									METRICS.map(function (row) {
										return (0, reactJsx.jsx)(
											FieldRow,
											{
												id: idSeed + "-" + row.field,
												label: t(row.labelKey),
												field: fields[row.field],
												writable: !disabled,
												t: t,
												onToggle: function (checked) {
													props.toggle(row.field, checked);
												},
												onReset: function () {
													props.resetField(row.field);
												}
											},
											row.field
										);
									}),
									(0, reactJsx.jsxs)("div", {
										className: CARD_CSS.field,
										children: [
											(0, reactJsx.jsxs)("div", {
												className: CARD_CSS.fieldHead,
												children: [
													(0, reactJsx.jsx)("label", { className: CARD_CSS.label, children: t("refresh") }),
													(0, reactJsx.jsxs)("span", {
														className: CARD_CSS.badges,
														children: [
															fields.refreshMs && fields.refreshMs.overridden
																? (0, reactJsx.jsx)("span", { className: CARD_CSS.badge, children: t("overridden") })
																: null,
															fields.refreshMs && fields.refreshMs.overridden
																? (0, reactJsx.jsx)("button", {
																		type: "button",
																		className: CARD_CSS.reset,
																		disabled: disabled,
																		onClick: function () {
																			props.resetField("refreshMs");
																		},
																		children: t("reset")
																	})
																: null
														]
													})
												]
											}),
											(0, reactJsx.jsx)("input", {
												className: CARD_CSS.input + (fields.refreshMs && fields.refreshMs.invalid ? " " + CARD_CSS.inputInvalid : ""),
												type: "text",
												inputMode: "numeric",
												value: fields.refreshMs ? fields.refreshMs.raw : "",
												disabled: disabled,
												onChange: function (event) {
													props.editRefresh(event.target.value);
												},
												onBlur: function () {
													props.commitRefresh();
												}
											}),
											fields.refreshMs && fields.refreshMs.invalid
												? (0, reactJsx.jsx)("p", { className: CARD_CSS.invalid, children: t("refreshInvalid") })
												: (0, reactJsx.jsx)("span", { className: CARD_CSS.hint, children: t("refreshHint") })
										]
									})
								]
							})
						: null
				]
			});
		}

		/**
		 * Mount the configuration card (locale dictionary + slot
		 * registration). Registration is unconditional (stock pattern); the
		 * component itself renders nothing until the namespace is served.
		 */
		function applyCard(ctx) {
			var scope;
			try {
				scope = ctx.settingsScope.bind({ namespace: SETTINGS_NS });
			} catch (error) {
				return noop;
			}
			if (typeof document !== "undefined") ensureCardCss(document);
			var controller = new HoverInformationCardController(scope);
			var disposers = [];
			function collect(result) {
				if (typeof result === "function") disposers.push(result);
			}
			collect(
				ctx.effect(
					function () {
						return function () {
							controller.dispose();
						};
					},
					"hover-info: card controller"
				)
			);
			collect(
				ctx.effect(
					function () {
						return ctx.slots.inject("settings.plugin.item", function () {
							return ctx.slots.register(
								{ name: "settings.plugin.item", key: SETTINGS_NS, locale: LOCALE_NS, inject: function () { return controller.inject(); } },
								HoverInformationCard
							);
						});
					},
					"hover-info: settings card"
				)
			);
			return function () {
				for (var i = 0; i < disposers.length; i++)
					try {
						disposers[i]();
					} catch (error) {}
			};
		}

		/**
		 * Mount the hover-card enhancer: watches `document.body` for the stock
		 * session hover card portal, resolves session identity, injects the
		 * copy buttons and the metrics block, and keeps them alive across the
		 * card's own re-renders — plus the two copy tools on the stock
		 * document-preview header (copy file content / copy file path;
		 * docs/PLAN.md §19).
		 */
		function applyEnhancer(ctx) {
			return ctx.effect(function () {
				var doc = typeof document !== "undefined" ? document : undefined;
				var win = typeof window !== "undefined" ? window : undefined;
				if (!doc || !win || typeof win.MutationObserver !== "function") return noop;

				var active = true;
				var refreshMs = DEFAULT_REFRESH_MS;
				var unsubscribeScope = noop;
				/** Per-card state, keyed by the live card element. */
				var cards = new Map();
				/** Per-preview state, keyed by the live preview root element. */
				var previews = new Map();
				/** Per-session stats cache: id → `{ at, view, pending }`. */
				var statsCache = new Map();
				var metricEnabled = {};
				for (var mi = 0; mi < METRICS.length; mi++) metricEnabled[METRICS[mi].field] = METRICS[mi].field === "showToolCalls" || METRICS[mi].field === "showActiveTime" || METRICS[mi].field === "showCacheRead" || METRICS[mi].field === "showCreatedAt" ? false : true;
				try {
					var scope = ctx.settingsScope.bind({ namespace: SETTINGS_NS });
					var readScope = function () {
						var snapshot = scope.getSnapshot();
						if (snapshot && snapshot.status === "ready" && snapshot.value) {
							var value = snapshot.value;
							if (value.active !== void 0) active = value.active !== false;
							var ms = Number(value.refreshMs);
							refreshMs = Number.isFinite(ms) && ms >= 1000 && ms <= 60000 ? ms : DEFAULT_REFRESH_MS;
							for (var k = 0; k < METRICS.length; k++) {
								var field = METRICS[k].field;
								if (value[field] !== void 0) metricEnabled[field] = value[field] === true;
							}
						}
						refreshAllCards();
					};
					unsubscribeScope = scope.subscribe(readScope) || noop;
					readScope();
				} catch (error) {
					active = true;
				}

				var disposeCss = ensureCss(doc);

				function sessionsSnapshot() {
					try {
						var sessions = ctx.get("sessions");
						if (!sessions || !sessions.list || typeof sessions.list.getSnapshot !== "function") return null;
						var snapshot = sessions.list.getSnapshot();
						if (!snapshot || typeof snapshot !== "object" || !snapshot.byId) return null;
						return snapshot;
					} catch (error) {
						return null;
					}
				}

				/**
				 * The `hoverInfo` projection value the browser session store
				 * already carries for one session (`byId[id].projectionValues`)
				 * — the same per-row projection block every other plugin reads
				 * (`agentPreset` reads it the same way), so this is zero extra
				 * IO. It is a HINT: as fresh as that session's last durable
				 * checkpoint, and simply absent for sessions that have not
				 * checkpointed since the `hoverInfo` unit registered.
				 * @returns the cached wire view, or null when there is none.
				 */
				function storeHint(sessionId) {
					var snap = sessionsSnapshot();
					var record = snap && snap.byId ? snap.byId[sessionId] : void 0;
					var values = record && record.projectionValues;
					var view = values ? values.hoverInfo : void 0;
					return view && typeof view === "object" ? view : null;
				}

				function translate(ns, key, params) {
					try {
						return String(ctx.locale.translate(ns, key, params));
					} catch (error) {
						return key;
					}
				}

				function translateSelf(key) {
					return translate(LOCALE_NS, key);
				}

				/**
				 * Typert call through the browser `connection` RPC
				 * (`dsh-client-connection` client half): POST /api +
				 * `{type:"client-request", rpcId, method, payload:{args}}`,
				 * result `{ok:true,value}` / `{ok:false,error}`. Any
				 * transport error or `ok:false` resolves null — fail-open.
				 */
				function callHostRpc(method, args) {
					var connection = null;
					try {
						connection = ctx.get("connection");
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
						function (result) {
							if (!result || result.ok !== true || result.value === void 0) return null;
							return result.value;
						},
						function () {
							return null;
						}
					);
				}

				/**
				 * Metrics view for one session, from two sources:
				 *
				 * 1. the live `hoverInfo/stats` fetch — authoritative, but only
				 *    answerable while the session is loaded in the host
				 *    (`session-not-found` otherwise, which is the common state
				 *    during and just after a cold start);
				 * 2. the browser store's cached projection for that session
				 *    (`storeHint`) — served whenever the live view is absent,
				 *    so a cold card still renders metrics instead of staying
				 *    stock until the session happens to be opened.
				 *
				 * The live fetch is gated per session: a settled hit by
				 * `refreshMs`; a miss/failure by `min(refreshMs,
				 * FAILURE_RETRY_MS)`, so warming up costs a few extra probes
				 * while a card is open instead of a whole TTL of blank card.
				 * While a fetch is in flight the current (possibly stale) live
				 * view is served, else the hint. A settled hit re-renders every
				 * open card of that session.
				 */
				function statsFor(sessionId) {
					var now = Date.now();
					var entry = statsCache.get(sessionId);
					if (entry === void 0) {
						entry = { at: 0, view: null, pending: false, settled: false };
						statsCache.set(sessionId, entry);
					}
					var ttl = entry.settled ? refreshMs : Math.min(refreshMs, FAILURE_RETRY_MS);
					if (!entry.pending && now - entry.at >= ttl) {
						entry.pending = true;
						callHostRpc("hoverInfo/stats", { sessionId: sessionId }).then(
							function (value) {
								var live = statsCache.get(sessionId);
								if (live === void 0) return;
								live.pending = false;
								live.at = Date.now();
								live.settled = !!value;
								if (value) {
									live.view = value;
									refreshAllCards();
								}
							},
							function () {
								var live = statsCache.get(sessionId);
								if (live !== void 0) {
									live.pending = false;
									live.at = Date.now();
									live.settled = false;
								}
							}
						);
					}
					if (entry.view !== null && entry.view !== void 0) return entry.view;
					return storeHint(sessionId);
				}

				function identify(cardEl) {
					var snap = sessionsSnapshot();
					var byId = snap && snap.byId ? snap.byId : {};
					var nodeId = findFiberSessionId(cardEl);
					if (nodeId !== void 0) {
						var record = byId[nodeId];
						return { id: nodeId, cwd: record && typeof record.cwd === "string" && record.cwd !== "" ? record.cwd : undefined };
					}
					var title = titleLine(cardEl);
					if (title === "" || looksPath(secondLineText(cardEl))) return null;
					var found;
					for (var candidateId in byId) {
						if (!Object.prototype.hasOwnProperty.call(byId, candidateId)) continue;
						var summary = byId[candidateId];
						if (!summary || summary.blank || summary.displayTitle !== title) continue;
						if (found !== void 0) {
							// Same title twice: break the tie on the card's
							// relative-time label; ambiguous → no injection.
							var matches = [];
							for (var otherId in byId) {
								if (!Object.prototype.hasOwnProperty.call(byId, otherId)) continue;
								var other = byId[otherId];
								if (other && !other.blank && other.displayTitle === title) matches.push(otherId);
							}
							var picked = pickByTime(cardEl, matches, byId);
							return picked === null ? null : { id: picked, cwd: byId[picked] ? byId[picked].cwd : undefined };
						}
						found = candidateId;
					}
					if (found === void 0) return null;
					return { id: String(found), cwd: typeof byId[found].cwd === "string" && byId[found].cwd !== "" ? byId[found].cwd : undefined };
				}

				function pickByTime(cardEl, candidates, byId) {
					var now = Date.now();
					var target = secondLineText(cardEl);
					var picked;
					for (var i = 0; i < candidates.length; i++) {
						var updatedAt = byId[candidates[i]].updatedAt;
						if (typeof updatedAt !== "number") return null;
						var bucket = relativeBucket(updatedAt, now);
						var label =
							bucket.unit === "now"
								? translate(WORKSPACE_NS, "time.now")
								: translate(WORKSPACE_NS, "time.ago", { t: translate(WORKSPACE_NS, "time." + bucket.unit, { n: bucket.n }) });
						if (label !== target) continue;
						if (picked !== void 0) return null;
						picked = candidates[i];
					}
					return picked === void 0 ? null : String(picked);
				}

				/** Walk the React fiber subtree of the portaled card for the SessionHoverContent `node` prop. */
				function findFiberSessionId(cardEl) {
					var root = fiberOf(cardEl);
					if (!root) return void 0;
					var queue = [root];
					var visited = 0;
					while (queue.length > 0 && visited < 80) {
						var fiber = queue.shift();
						visited += 1;
						var props = fiber.memoizedProps;
						if (props && typeof props === "object" && props.node && typeof props.node === "object" && props.node.id !== void 0) {
							return String(props.node.id);
						}
						if (fiber.child) queue.push(fiber.child);
						if (fiber.sibling) queue.push(fiber.sibling);
					}
					return void 0;
				}

				function fiberOf(el) {
					try {
						// React stores the fiber under a non-enumerable
						// `__reactFiber$…` own property, so getOwnPropertyNames
						// is required (Object.keys would miss it).
						var keys = typeof Object.getOwnPropertyNames === "function" ? Object.getOwnPropertyNames(el) : Object.keys(el);
						for (var i = 0; i < keys.length; i++) {
							if (keys[i].indexOf("__reactFiber$") === 0) return el[keys[i]];
						}
					} catch (error) {}
					return void 0;
				}

				/**
				 * The stock body lines of a card, in order: the card's stack children
				 * minus anything this plugin injected. Every line probe — the DOM
				 * fallback's title/time reads and the header-row rebuild — goes
				 * through here, so an injected row can never shift a title probe.
				 */
				function cardLines(cardEl) {
					var stack = cardEl && cardEl.firstElementChild;
					var lines = [];
					if (!stack || !stack.children) return lines;
					for (var i = 0; i < stack.children.length; i++) {
						var child = stack.children[i];
						var cls = child.classList;
						if (cls && (cls.contains("dhi-twrap") || cls.contains("dhi-bar") || cls.contains("dhi-metrics"))) continue;
						lines.push(child);
					}
					return lines;
				}

				/** The stock title line: the FIRST line of a pristine card. */
				function titleLine(cardEl) {
					var first = cardLines(cardEl)[0];
					if (!first) return "";
					return String(first.textContent || "").trim();
				}

				/**
				 * The stock relative-time line's text — the line that follows the
				 * title on a pristine card. Returns "" once the header row folded it
				 * in (its text then lives inside `.dhi-lead`, not on its own line).
				 */
				function secondLineText(cardEl) {
					var lines = cardLines(cardEl);
					if (lines.length > 1) return String(lines[1].textContent || "").trim();
					return "";
				}

				function looksPath(text) {
					return !!text && (text.indexOf("/") >= 0 || text.indexOf("\\") >= 0);
				}

				/**
				 * Bucket the same thresholds the shell's relativeTime uses;
				 * only the DOM-visible distance bucket is needed (the
				 * tie-break label).
				 */
				function relativeBucket(updatedAt, now) {
					var delta = Math.max(0, now - updatedAt);
					if (delta < 6e4) return { unit: "now", n: 0 };
					if (delta < 36e5) return { unit: "minutes", n: Math.floor(delta / 6e4) };
					if (delta < 864e5) return { unit: "hours", n: Math.floor(delta / 36e5) };
					if (delta < 30 * 864e5) return { unit: "days", n: Math.floor(delta / 864e5) };
					if (delta < 365 * 864e5) return { unit: "months", n: Math.floor(delta / (30 * 864e5)) };
					return { unit: "years", n: Math.floor(delta / (365 * 864e5)) };
				}

				function writeClipboard(win, text) {
					if (typeof text !== "string" || text === "") return Promise.resolve(false);
					var clipboard = win.navigator && win.navigator.clipboard;
					if (clipboard && typeof clipboard.writeText === "function") {
						try {
							return clipboard.writeText(text).then(
								function () {
									return true;
								},
								function () {
									return legacyCopy(win, text);
								}
							);
						} catch (error) {
							return Promise.resolve(false);
						}
					}
					return Promise.resolve(legacyCopy(win, text));
				}

				function legacyCopy(win, text) {
					try {
						var area = doc.createElement("textarea");
						area.value = text;
						area.setAttribute("readonly", "");
						area.style.position = "fixed";
						area.style.left = "-9999px";
						doc.body.appendChild(area);
						area.select();
						var ok = typeof doc.execCommand === "function" && doc.execCommand("copy");
						area.remove();
						return !!ok;
					} catch (error) {
						return false;
					}
				}

				/**
				 * One injected copy button.
				 *
				 * `entry` fields:
				 *  - `kind`   : the value stamped on the attribute (stable
				 *    for tests / re-enumeration);
				 *  - `icon`   : key into `ICONS` to restore after feedback
				 *    (defaults to `kind`);
				 *  - `className`: chrome class (defaults to the hover-card
				 *    button class; the preview passes the header-tool one);
				 *  - `attr`   : attribute name (defaults to `data-hi-copy`);
				 *  - `label`  : `aria-label`/`title` already localized;
				 *  - `value`  : a string, OR
				 *  - `get`    : `function () → string | Promise<string>`
				 *    (the preview resolves its source lazily; the hover card
				 *    always passes a ready `value`).
				 */
				function makeButton(entry, state) {
					var className = typeof entry.className === "string" ? entry.className : "dhi-btn";
					var attr = typeof entry.attr === "string" ? entry.attr : "data-hi-copy";
					var icon = typeof entry.icon === "string" ? entry.icon : entry.kind;
					var button = doc.createElement("button");
					button.type = "button";
					button.className = className;
					button.setAttribute(attr, entry.kind);
					var label = typeof entry.label === "string" ? entry.label : translateSelf(entry.kind);
					button.title = label;
					button.setAttribute("aria-label", label);
					button.innerHTML = ICONS[icon];
					button.addEventListener("click", function (event) {
						event.stopPropagation();
						var source = typeof entry.get === "function" ? entry.get() : entry.value;
						var settled = source && typeof source.then === "function" ? source : Promise.resolve(source);
						settled.then(
							function (text) {
								writeClipboard(win, typeof text === "string" ? text : "").then(
									function (ok) {
										if (!ok) return;
										button.innerHTML = ICONS.done;
										var timer = win.setTimeout(function () {
											button.innerHTML = ICONS[icon];
										}, COPY_FEEDBACK_MS);
										state.timers.push(timer);
									},
									function () {}
								);
							},
							function () {}
						);
					});
					return button;
				}

				/** Rendered metric rows for a view: enabled, non-empty, DOM order. */
				function metricRows(view) {
					var rows = [];
					for (var i = 0; i < METRICS.length; i++) {
						var row = METRICS[i];
						if (!metricEnabled[row.field]) continue;
						var value = rowValues(row, view);
						if (value === null) continue;
						rows.push({ row: row, value: value });
					}
					return rows;
				}

				/** Identity of a rendered block; equal signatures need no DOM write. */
				function metricsSignature(rows) {
					var parts = [];
					for (var i = 0; i < rows.length; i++) parts.push(rows[i].row.key + "=" + rows[i].value.value);
					return parts.join("\n");
				}

				/** Build one metrics block element from rendered rows; null if none. */
				function buildMetricsBlock(rows) {
					var block = null;
					for (var i = 0; i < rows.length; i++) {
						var row = rows[i].row;
						var value = rows[i].value;
						if (block === null) {
							block = doc.createElement("div");
							block.className = "dhi-metrics";
							block.setAttribute("data-hi-metrics", "1");
						}
						var line = doc.createElement("div");
						line.className = value.bar ? "dhi-mrow-context" : "dhi-mrow";
						line.setAttribute("data-hi-metric", row.key);
						var k = doc.createElement("span");
						k.className = "dhi-k";
						k.textContent = translateSelf(row.labelKey);
						var v = doc.createElement("span");
						v.className = "dhi-v";
						v.textContent = value.value;
						line.appendChild(k);
						line.appendChild(v);
						if (value.bar) {
							var bar = doc.createElement("div");
							bar.className = "dhi-ctxbar";
							var fill = doc.createElement("div");
							fill.className = value.bar.tone;
							fill.style.width = Math.max(0, Math.min(100, value.bar.percent)) + "%";
							bar.appendChild(fill);
							line.appendChild(bar);
						}
						block.appendChild(line);
					}
					return block;
				}

				/**
				 * Re-sync one card's copy bar and metrics block.
				 *
				 * Every DOM write here is guarded ("only when actually
				 * different"): the bar is re-appended only when the stack no
				 * longer holds it, and the metrics block is rebuilt only when
				 * its rendered signature — or its presence in the DOM — changes.
				 * An unguarded rebuild appends a new block node into the very
				 * subtree the card's own MutationObserver watches, so every sync
				 * re-arms the observer: once metrics render, the callbacks spin
				 * a DOM-churn microtask loop that starves rendering and freezes
				 * the tab the moment the card appears. A settled sync must
				 * therefore touch nothing; the re-injection the observer is
				 * *for* — React's "Copied" re-render sweeping the injected
				 * nodes — is a real change and still re-syncs.
				 */
				function syncCard(state) {
					if (state.syncing) return;
					state.syncing = true;
					try {
						var cardEl = state.cardEl;
						if (!cardEl.isConnected) return;

						// Re-build the time+bar wrapper when it was removed.
						if (!state.twrap) {
							rebuildTimeWrap(state, cardEl);
						} else if (!cardEl.contains(state.twrap)) {
							// twrap detached → nuke stale leftovers and reconstruct.
							var stack = cardEl.firstElementChild;
							if (stack) {
								var bar = state.bar;
								for (var j = stack.children.length - 1; j >= 0; j--) {
									var ch = stack.children[j];
									if (ch.classList && ch.classList.contains("dhi-bar") && ch !== bar) stack.removeChild(ch);
								}
							}
							rebuildTimeWrap(state, cardEl);
						}

						// Old-style standalone bar (direct child of stack): remove.
						{
							var stack = cardEl.firstElementChild;
							if (stack) {
								var bar = state.bar;
								for (var s = stack.children.length - 1; s >= 0; s--) {
									var ch = stack.children[s];
									if (ch.classList && ch.classList.contains("dhi-bar") && ch !== bar) stack.removeChild(ch);
								}
							}
						}

						if (cardEl.getAttribute("role") === "button") cardEl.removeAttribute("role");
						if (cardEl.hasAttribute("tabindex")) cardEl.removeAttribute("tabindex");
						if (cardEl.style.cursor !== "default") cardEl.style.cursor = "default";

						var view = statsFor(state.sessionId);
						var rows = metricRows(view);
						var want = rows.length > 0;
						var contained = state.metrics !== null && cardEl.contains(state.metrics);
						if (contained !== want || (want && state.signature !== metricsSignature(rows))) {

							if (state.metrics !== null && state.metrics.parentElement) state.metrics.parentElement.removeChild(state.metrics);
							state.metrics = null;
							state.signature = "";
							if (want) {
								var reStack = cardEl.firstElementChild;
								if (reStack) {
									var block = buildMetricsBlock(rows);
									reStack.appendChild(block);
									state.metrics = block;
									state.signature = metricsSignature(rows);
								}
							}
						}
					} finally {
						state.syncing = false;
					}
				}

				/**
				 * Build (or re-build) the header row: one `.dhi-twrap` flex line
				 * holding — on the LEFT — the first `hoverStatus` glyph (cloned,
				 * icon only) + the relative-time text; on the RIGHT the copy
				 * buttons.
				 *
				 * Everything sits on that single line so the status glyph and the
				 * "X time ago" text are vertically in line with the Copy-ID /
				 * Copy-path icons. The buttons no longer float absolutely over
				 * the title line — that absolute placement is exactly what left
				 * them mis-aligned (and what the 70px title inset was papering
				 * over).
				 *
				 * The row is the card's FIRST line, ABOVE the title (the stock
				 * order was title → time; the row takes the top slot, the title
				 * keeps the second one).
				 *
				 * Locating is structural, on the PRISTINE stack, before any
				 * injected node lands (no child-index arithmetic — the old
				 * `children[2]` shifted as soon as the bar was inserted, which is
				 * why no glyph was ever cloned):
				 *  - the title line is the first stock line — it gets a
				 *    `data-hi-title` marker so the injected CSS can pin its 16px
				 *    size without the plugin ever matching a hash-prefixed
				 *    `*_hoverTitle` class;
				 *  - the time line by its relative-time text shape;
				 *  - the status glyph as the first `[data-state]` node owned by
				 *    the lines AFTER the title/time lines — live DOM proved the
				 *    stock `StateDot` renders as `<span data-state="done"
				 *    style="width:10px;height:10px">`, NOT an svg, so an
				 *    `svg`-only probe never fires; `data-state` stays stable even
				 *    though the `_dot_*` class it carries is hash-prefixed, and
				 *    the svg shape is still tried as the fallback.
				 *
				 * The stock status lines carry that glyph plus its label
				 * (`Idle`, `Running`, …). Per the follow-up request they are
				 * COLLAPSED: the lines themselves are removed and their text
				 * becomes the clone's `title` (one icon on the row instead of
				 * `dot + label` per status; several statuses join as
				 * `"Running · Waiting"`).
				 */
				function rebuildTimeWrap(state, cardEl) {
					var stack = cardEl.firstElementChild;
					if (!stack) return;
					var bar = state.bar;

					// Stock lines only: skip injected/stale nodes.
					var lines = cardLines(cardEl);

					// Relative-time line ("3 min ago", "now", …).
					var timeEl = null;
					var timeAt = -1;
					for (var ti = 0; ti < lines.length; ti++) {
						var text = (lines[ti].textContent || "").trim();
						if (/^\d/.test(text) || text.indexOf("min") >= 0 || text.indexOf("sec") >= 0 || text.indexOf("ago") >= 0 || text.indexOf("now") >= 0) {
							timeEl = lines[ti];
							timeAt = ti;
							break;
						}
					}

					// Status lines follow the title (and, when present, the time
					// line), and each owns its `StateDot` glyph. Collect them all:
					// the first glyph feeds the row's icon, every label becomes
					// that icon's `title`, and the lines themselves go away.
					var statusStart = timeAt >= 0 ? timeAt + 1 : 1;
					var glyph = null;
					var statusLines = [];
					var statusLabels = [];
					for (var si = statusStart; si < lines.length; si++) {
						if (!lines[si].querySelector) continue;
						var own = lines[si].querySelector("[data-state]") || lines[si].querySelector("svg");
						if (!own) continue;
						if (glyph === null) glyph = own;
						var label = (lines[si].textContent || "").trim();
						if (label) statusLabels.push(label);
						statusLines.push(lines[si]);
					}
					var statusTitle = statusLabels.join(" · ");

					// The title line is the first stock line — unless the relative-time
					// probe landed on index 0, which means this card has no title line
					// and `lines[0]` is the line about to be replaced.
					var titleEl = timeAt === 0 ? null : lines[0] || null;
					if (titleEl) titleEl.dataset.hiTitle = "1";

					var twrap = doc.createElement("div");
					twrap.className = "dhi-twrap";
					twrap.dataset.hiTwrap = "1";
					var lead = doc.createElement("span");
					lead.className = "dhi-lead";
					lead.dataset.hiLead = "1";
					twrap.appendChild(lead);

					if (glyph) {
						var clone = glyph.cloneNode(true);
						// The stock dot already carries its own inline size — a
						// cssText override would wipe it — and it keeps its
						// `data-state` so the color rules still apply to the
						// clone. Only un-float it.
						clone.style.flex = "none";
						clone.dataset.hiStatusIcon = "1";
						if (statusTitle) {
							// The status text survives here, as the icon's title.
							clone.setAttribute("title", statusTitle);
							clone.setAttribute("aria-label", statusTitle);
							clone.removeAttribute("aria-hidden");
						}
						lead.appendChild(clone);
					}
					twrap.appendChild(bar);
					if (timeEl) {
						var timeSpan = doc.createElement("span");
						timeSpan.textContent = timeEl.textContent;
						timeSpan.style.whiteSpace = "nowrap";
						lead.appendChild(timeSpan);
					}

					// The row sits at the TOP of the stack — right above the title
					// line. A card with no title line falls back to where the time
					// line was, so it never ends up below the remaining lines.
					var anchor = titleEl || timeEl || statusLines[0] || (lines.length > 1 ? lines[1] : null);
					if (anchor) stack.insertBefore(twrap, anchor);
					else stack.appendChild(twrap);
					if (timeEl) timeEl.remove();
					for (var ri = 0; ri < statusLines.length; ri++) {
						if (statusLines[ri].parentElement) statusLines[ri].remove();
					}
					state.twrap = twrap;
				}

				function refreshAllCards() {
					cards.forEach(function (state) {
						try {
							syncCard(state);
						} catch (error) {}
					});
				}

				function enhanceCard(cardEl) {
					var info = identify(cardEl);
					if (!info || info.id === void 0) return false;
					// Marker for tests + re-enumeration by future body observers.
					cardEl.setAttribute("data-hi-session", String(info.id));

					var bar = doc.createElement("div");
					bar.className = "dhi-bar";
					bar.setAttribute("data-hi", "1");
					var state = { cardEl: cardEl, bar: bar, twrap: null, metrics: null, signature: "", sessionId: info.id, timers: [], observer: null, syncing: false, swallow: null };
					var entries = [
						{ kind: "id", value: String(info.id), label: translateSelf("copySessionId") },
						...(info.cwd ? [{ kind: "path", value: String(info.cwd), label: translateSelf("copyWorkspacePath") }] : [])
					];
					for (var i = 0; i < entries.length; i++) bar.appendChild(makeButton(entries[i], state));

					// Build the restructured layout: time+bar inline, status on title.
					rebuildTimeWrap(state, cardEl);

					// Neutralize the stock whole-card copy: the card is the
					// whole copy surface (`role="button"` + click → copyText),
					// which the corner icons now replace.
					state.swallow = function (event) {
						event.stopPropagation();
					};
					cardEl.addEventListener("click", state.swallow, false);
					cardEl.addEventListener("keydown", state.swallow, false);

					// Re-apply: React's "Copied" re-render sweeps the injected
					// nodes; the observer re-syncs while the card stays open.
					var observer = new win.MutationObserver(function () {
						try {
							if (!cardEl.isConnected) return;
							syncCard(state);
						} catch (error) {}
					});
					observer.observe(cardEl, { childList: true, subtree: true });
					state.observer = observer;
					cards.set(cardEl, state);
					startSweep();
					syncCard(state);
					return true;
				}

				function cleanupCard(cardEl) {
					var state = cards.get(cardEl);
					if (!state) return;
					if (state.observer) state.observer.disconnect();
					for (var i = 0; i < state.timers.length; i++) win.clearTimeout(state.timers[i]);
					state.timers.length = 0;
					cards.delete(cardEl);
					if (cards.size === 0 && previews.size === 0) stopSweep();
				}

				/**
				 * ── Document-preview enhancer ────────────────────────────────
				 *
				 * Two header tools on the stock document preview (the
				 * sidebar's open-file panel): **copy file content** and
				 * **copy file path**.
				 *
				 * Detection uses ONLY stable shell data attributes — the
				 * preview root's `data-document-preview` and the header path
				 * element's `data-textpreview-path` (whose `title` is the
				 * absolute display path) — never hashed CSS-module class
				 * names (AGENTS rule). Discovery: (a) records from a body-wide
				 * observer watching exactly that one attribute (so a header
				 * mounting anywhere in the tree costs a near-zero record),
				 * and (b) a single bounded tree scan for a preview already
				 * open when the bundle mounts (a reloaded session with a file
				 * tab restored fires no records). Each enhanced preview keeps
				 * its own subtree observer; the lazy sweep forgets roots the
				 * shell removed.
				 *
				 * Content source, in order:
				 *  1. the renderer's `content` prop through the fiber
				 *     fast-path (same technique as the hover-card session
				 *     id): `{ kind: "text", text, eof }` is the SOURCE the DOM
				 *     lines are built from, so the copy is exact regardless
				 *     of the active viewer (the Markdown viewer's DOM is
				 *     rendered HTML, not source);
				 *  2. for `eof: false` (a file wider than one page, so only
				 *     the loaded pages are in view) the host
				 *     `workspaceFiles/readAll` answers the whole file; its
				 *     scope parameter rides the wire as a `workspaceFileScopeId`
				 *     resolved to a live session — the lookup derives that
				 *     session's workspace root only for *relative* paths,
				 *     and what we always request is the header's absolute
				 *     path, so the choice of which live id to carry is
				 *     behaviorally irrelevant. No live session → fall back;
				 *  3. else copy the loaded (partial) source;
				 *  4. else (no text source at all — e.g. the byte renderers)
				 *     the click copies nothing: fail-open, one debug line.
				 */
				function findByAttributeIn(rootEl, attr, budget) {
					var queue = [rootEl];
					var visited = 0;
					while (queue.length > 0) {
						if (visited >= budget) return null;
						var node = queue.shift();
						visited += 1;
						var children = node.children || [];
						for (var i = 0; i < children.length; i++) {
							var child = children[i];
							if (child.nodeType !== 1) continue;
							if (child.hasAttribute && child.hasAttribute(attr)) return child;
							queue.push(child);
						}
					}
					return null;
				}

				/** The preview root is a tagged ancestor of the path element. */
				function previewRootOf(pathEl) {
					var node = pathEl.parentElement;
					for (var hops = 0; node && hops < 6; hops++) {
						if (node.hasAttribute && node.hasAttribute(PREVIEW_ROOT_ATTR)) return node;
						node = node.parentElement;
					}
					return null;
				}

				/**
				 * Fiber fast-path: the body renderer's `content` prop — the
				 * source the lines are built from. Bounded like the card's
				 * session-id walk (docs/PLAN.md §6.2).
				 * @returns `{ text, eof }`, or null for no text view.
				 */
				function findPreviewContent(rootEl) {
					var fiber = fiberOf(rootEl);
					if (!fiber) return null;
					var queue = [fiber];
					var visited = 0;
					while (queue.length > 0 && visited < 400) {
						var node = queue.shift();
						visited += 1;
						var props = node.memoizedProps;
						if (props && typeof props === "object") {
							var content = props.content;
							if (content && typeof content === "object" && content.kind === "text" && typeof content.text === "string") {
								return { text: content.text, eof: content.eof === true };
							}
						}
						if (node.child) queue.push(node.child);
						if (node.sibling) queue.push(node.sibling);
					}
					return null;
				}

				/** The absolute path shown in the header (`title` = displayPath). */
				function previewAbsolutePath(state) {
					var pathEl = state.pathEl && state.pathEl.isConnected ? state.pathEl : findByAttributeIn(state.rootEl, PREVIEW_PATH_ATTR, 3000);
					if (!pathEl || typeof pathEl.getAttribute !== "function") return "";
					var title = pathEl.getAttribute("title");
					return typeof title === "string" ? title : "";
				}

				/** First live session id — the wire identity for the file-scope lookup. */
				function pickScopeSessionId() {
					var snap = sessionsSnapshot();
					var byId = snap && snap.byId ? snap.byId : null;
					if (!byId) return "";
					for (var id in byId) {
						if (!Object.prototype.hasOwnProperty.call(byId, id)) continue;
						return String(id);
					}
					return "";
				}

				/** Base64 → UTF-8 text; `null` when undecodable (fail-open). */
				function decodeBase64Text(value) {
					if (typeof value !== "string" || value === "") return null;
					try {
						var raw = typeof win.atob === "function" ? win.atob(value) : null;
						if (typeof raw !== "string") return null;
						if (typeof win.TextDecoder === "function") {
							var bytes = new Uint8Array(raw.length);
							for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
							return new win.TextDecoder("utf-8").decode(bytes);
						}
						return decodeURIComponent(escape(raw));
					} catch (error) {
						return null;
					}
				}

				/**
				 * The whole file from the host — for previews whose loaded
				 * pages do not reach eof. `workspaceFiles/readAll` answers
				 * `data` base64 over the same `/api` envelope the stats call
				 * uses; the scope id picks the workspace root only, never
				 * confines an absolute `path` (docs/PLAN.md §19).
				 * @returns promise of the text, or null on any failure.
				 */
				function fetchPreviewFileText(state) {
					var scopeId = pickScopeSessionId();
					var path = previewAbsolutePath(state);
					if (scopeId === "" || path === "") return Promise.resolve(null);
					return callHostRpc("workspaceFiles/readAll", { workspaceFileScopeId: scopeId, path: path }).then(
						function (value) {
							if (!value || typeof value !== "object") return null;
							return decodeBase64Text(value.data);
						},
						function () {
							return null;
						}
					);
				}

				/**
				 * Resolve the source a content-copy click will hand to the
				 * clipboard; `""` means nothing to copy (no feedback).
				 */
				function resolvePreviewText(state) {
					var hit = findPreviewContent(state.rootEl);
					if (!hit) {
						if (typeof console !== "undefined" && typeof console.debug === "function") {
							console.debug("hover-info: preview has no text source (byte renderer or unloaded)");
						}
						return Promise.resolve("");
					}
					if (hit.eof) return Promise.resolve(hit.text);
					return fetchPreviewFileText(state).then(function (full) {
						// No host answer: still copy what loaded rather
						// than silently do nothing on an already-shown file.
						return typeof full === "string" ? full : hit.text;
					});
				}

				/** Inject/refresh one preview's header tools. Idempotent. */
				function enhancePreview(rootEl) {
					if (previews.has(rootEl)) return true;
					var pathEl = findByAttributeIn(rootEl, PREVIEW_PATH_ATTR, 3000);
					if (!pathEl) return false;
					var bar = doc.createElement("div");
					bar.className = "dhi-tools";
					bar.setAttribute("data-hi-tools", "1");
					var state = { rootEl: rootEl, pathEl: pathEl, bar: bar, timers: [], observer: null, syncing: false };
					bar.appendChild(
						makeButton({
							kind: "content",
							icon: "copy",
							className: "dhi-tool",
							attr: "data-hi-preview-tool",
							label: translateSelf("copyFileContent"),
							get: function () {
								return resolvePreviewText(state);
							}
						}, state)
					);
					bar.appendChild(
						makeButton({
							kind: "path",
							icon: "path",
							className: "dhi-tool",
							attr: "data-hi-preview-tool",
							label: translateSelf("copyFilePath"),
							get: function () {
								return previewAbsolutePath(state);
							}
						}, state)
					);
					var observer = new win.MutationObserver(function () {
						try {
							if (!rootEl.isConnected) return;
							syncPreview(state);
						} catch (error) {}
					});
					observer.observe(rootEl, { childList: true, subtree: true });
					state.observer = observer;
					previews.set(rootEl, state);
					startSweep();
					syncPreview(state);
					return true;
				}

				/**
				 * Diff-only resync: the tools bar re-seats at the end of the
				 * current header (React's own re-renders can append tool
				 * buttons after ours), and the path element re-resolves —
				 * a swapped file tab keeps one root with a different path
				 * element/title. A settled sync touches nothing (the
				 * observer-for-the-observer is what React's re-render
				 * sweeping injected nodes is, not DOM churn).
				 */
				function syncPreview(state) {
					if (state.syncing) return;
					state.syncing = true;
					try {
						var rootEl = state.rootEl;
						if (!rootEl.isConnected) return;
						var pathEl = state.pathEl && state.pathEl.isConnected ? state.pathEl : findByAttributeIn(rootEl, PREVIEW_PATH_ATTR, 3000);
						if (!pathEl) return;
						state.pathEl = pathEl;
						var header = pathEl.parentElement;
						if (!header) return;
						var children = header.children || [];
						if (state.bar.parentElement !== header || children[children.length - 1] !== state.bar) header.appendChild(state.bar);
					} finally {
						state.syncing = false;
					}
				}

				function cleanupPreview(rootEl) {
					var state = previews.get(rootEl);
					if (!state) return;
					if (state.observer) state.observer.disconnect();
					for (var i = 0; i < state.timers.length; i++) win.clearTimeout(state.timers[i]);
					state.timers.length = 0;
					previews.delete(rootEl);
					if (cards.size === 0 && previews.size === 0) stopSweep();
				}

				// Live sweep: refreshes open cards past the TTL and forgets
				// cards the shell already dropped (defensive; removal records
				// normally cover the common path). Lazy (docs/ROADMAP.md
				// Fase 2b): the 1 s heartbeat only runs while at least one
				// card is open — an idle tab keeps no wakeups — and the
				// handle is unref'd so a forgotten `dispose` in tests can
				// never hold the process alive (`unref` exists only in
				// Node; browser handles are numbers, hence the structural
				// check).
				var sweepTimer = null;
				function sweepTick() {
					try {
						if (cards.size === 0 && previews.size === 0) {
							stopSweep();
							return;
						}
						if (!active) return;
						cards.forEach(function (state) {
							if (!state.cardEl.isConnected) cleanupCard(state.cardEl);
							else syncCard(state);
						});
						previews.forEach(function (state, rootEl) {
							if (!rootEl.isConnected) cleanupPreview(rootEl);
							else syncPreview(state);
						});
						if (cards.size === 0 && previews.size === 0) stopSweep();
					} catch (error) {}
				}
				/** The heartbeat exists only while at least one card/preview is open. */
				function startSweep() {
					if (sweepTimer !== null || (cards.size === 0 && previews.size === 0)) return;
					sweepTimer = win.setInterval(sweepTick, 1000);
					if (sweepTimer !== null && typeof sweepTimer.unref === "function") sweepTimer.unref();
				}
				function stopSweep() {
					if (sweepTimer === null) return;
					var timer = sweepTimer;
					sweepTimer = null;
					try {
						win.clearInterval(timer);
					} catch (error) {}
				}

				var bodyObserver = new win.MutationObserver(function (records) {
					try {
						if (!active) return;
						for (var r = 0; r < records.length; r++) {
							var record = records[r];
							// Records may carry only one kind; tolerate the
							// others (attribute records arrive here in the
							// DOM stub, never in browsers).
							var removedNodes = record.removedNodes || [];
							for (var removed = 0; removed < removedNodes.length; removed++) cleanupCard(removedNodes[removed]);
							if (!active) return;
							var addedNodes = record.addedNodes || [];
							for (var added = 0; added < addedNodes.length; added++) {
								var node = addedNodes[added];
								if (!isHoverCard(doc, win, node)) continue;
								if (node.nodeType === 1 && cards.has(node)) continue;
								enhanceCard(node);
							}
						}
					} catch (error) {
						console.warn("hover-info: hover-card enhance skipped:", error);
					}
				});
				bodyObserver.observe(doc.body, { childList: true });

				// Preview discovery. A file opening MOUNTS the preview DOM somewhere
				// inside the body subtree — and its anchor attributes arrive *with* the
				// elements they are stamped on, so an attribute record can never fire
				// for a fresh mount (the value reads "true" from the first commit; a
				// later tab-swap never changes it). childList records catch the mount
				// (the added subtree carries the root); attribute records stay for a
				// re-keyed path element. Chat churn is kept cheap by scanning only the
				// added subtrees and only with a budget, after O(1) attribute probes.
				var previewObserver = new win.MutationObserver(function (records) {
					try {
						if (!active) return;
						for (var r = 0; r < records.length; r++) {
							var record = records[r];
							if (!record) continue;
							var rootEl = null;
							if (record.type === "attributes") {
								var target = record.target;
								if (!target || target.nodeType !== 1 || !target.isConnected) continue;
								if (!(target.hasAttribute && target.hasAttribute(PREVIEW_PATH_ATTR))) continue;
								rootEl = previewRootOf(target);
							} else {
								// childList (and the record kinds that do not carry
								// additions): DOM mutating *inside* an unregistered
								// root is where a toolless preview lives too (a
								// loaded-then-ready state, a swapped tab re-keying).
								var walker = record.target;
								if (walker && walker.nodeType === 1 && walker.isConnected) {
									for (var hops = 0; walker && hops < 6; walker = walker.parentElement, hops++) {
										if (walker.hasAttribute && walker.hasAttribute(PREVIEW_ROOT_ATTR)) {
											rootEl = walker;
											break;
										}
									}
								}
								if (rootEl === null) {
									var addedNodes = record.addedNodes || [];
									var stop = Math.min(addedNodes.length, 16);
									for (var n = 0; n < stop && rootEl === null; n++) {
										var node = addedNodes[n];
										if (!node || node.nodeType !== 1) continue;
										if (node.hasAttribute && node.hasAttribute(PREVIEW_ROOT_ATTR)) rootEl = node;
										else if (node.hasAttribute && node.hasAttribute(PREVIEW_PATH_ATTR)) rootEl = previewRootOf(node);
										else rootEl = findByAttributeIn(node, PREVIEW_ROOT_ATTR, 64);
									}
								}
							}
							if (rootEl === null || !rootEl.isConnected || previews.has(rootEl)) continue;
							if (!enhancePreview(rootEl) && typeof console.debug === "function") {
								console.debug("hover-info: preview header incomplete (no path element)");
							}
						}
					} catch (error) {
						console.warn("hover-info: preview enhance skipped:", error);
					}
				});
				previewObserver.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: [PREVIEW_PATH_ATTR] });

				// A preview already open at mount time fired no records —
				// one bounded scan catches the reloaded-session case.
				var openPreview = findByAttributeIn(doc.body, PREVIEW_ROOT_ATTR, 40000);
				if (openPreview !== null && active) enhancePreview(openPreview);

				return function dispose() {
					try {
						bodyObserver.disconnect();
					} catch (error) {}
					try {
						previewObserver.disconnect();
					} catch (error) {}
					try {
						stopSweep();
					} catch (error) {}
					cards.forEach(function (state) {
						if (state.observer) state.observer.disconnect();
						for (var i = 0; i < state.timers.length; i++) win.clearTimeout(state.timers[i]);
					});
					cards.clear();
					previews.forEach(function (state) {
						if (state.observer) state.observer.disconnect();
						for (var i = 0; i < state.timers.length; i++) win.clearTimeout(state.timers[i]);
					});
					previews.clear();
					statsCache.clear();
					unsubscribeScope();
					disposeCss();
				};
			}, "hover-info: hover-card enhancer");
		}

		/**
		 * Structural hover-card detector (docs/PLAN.md §6.2): a
		 * `position: fixed` 244 px portal child of `body` with numeric
		 * left/top and a ≥2-child column stack. Matches structure only —
		 * hashed CSS-module class names change per build.
		 */
		function isHoverCard(doc, win, el) {
			try {
				if (!el || el.nodeType !== 1 || el.tagName !== "DIV") return false;
				if (el.parentElement !== doc.body) return false;
				var cs = win.getComputedStyle(el);
				if (cs.position !== "fixed") return false;
				var width = parseFloat(cs.width);
				if (!(Math.abs(width - HOVER_CARD_WIDTH) < 0.5)) return false;
				if (typeof el.style.left !== "string" || el.style.left === "" || !/px\s*$/.test(el.style.left)) return false;
				if (typeof el.style.top !== "string" || el.style.top === "" || !/px\s*$/.test(el.style.top)) return false;
				var stack = el.firstElementChild;
				if (!stack || stack.tagName !== "DIV") return false;
				var stackCs = win.getComputedStyle(stack);
				return stackCs.display === "flex" && stackCs.flexDirection === "column" && stack.children.length >= 2;
			} catch (error) {
				return false;
			}
		}

		function apply(ctx) {
			var disposers = [];
			function collect(result) {
				if (typeof result === "function") disposers.push(result);
			}
			try {
				collect(
					ctx.effect(function () {
						var off = noop;
						try {
							off = ctx.locale.register(LOCALE_NS, DICTIONARY) || noop;
						} catch (error) {}
						return off;
					}, "hover-info: dictionaries")
				);
			} catch (error) {}
			if (ctx.slots && typeof ctx.slots.inject === "function" && ctx.settingsScope) {
				try {
					collect(applyCard(ctx));
				} catch (error) {}
			}
			try {
				collect(applyEnhancer(ctx));
			} catch (error) {}
			return function () {
				for (var i = 0; i < disposers.length; i++)
					try {
						disposers[i]();
					} catch (error) {}
			};
		}

		exports.apply = apply;
		exports.applyCard = applyCard;
		exports.applyEnhancer = applyEnhancer;
		exports.inject = inject;
		return exports;
	}
});
