/**
 * Host-half tests: plugin identity, the complete defaults of the settings
 * schema, and the apply() wiring (settings section + projection registration
 * + remote mount) against fake host faces. No live composition, no network.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { apply, Config, inject, name, SETTINGS_NAMESPACE } from "../lib/index.js";
import { hoverInfoProjectionDefinition } from "../lib/unit.js";

test("plugin identity", () => {
	assert.equal(name, "hover-info");
	assert.deepEqual(inject, ["settings"]);
	assert.equal(SETTINGS_NAMESPACE, "hover-info");
});

test("base schema defaults are complete and match docs/PLAN.md §4", () => {
	const value = Config["~standard"].validate({}).value;
	assert.deepEqual(value, {
		active: true,
		refreshMs: 30000,
		showTurns: true,
		showSteps: true,
		showTokensIn: true,
		showTokensOut: true,
		showCompactions: true,
		showContext: true,
		showSubagents: true,
		showModel: true,
		showToolCalls: false,
		showActiveTime: false,
		showCacheRead: false,
		showCreatedAt: false
	});
});

test("refreshMs bounds reject out-of-range and fractional values", () => {
	for (const bad of [999, 60001, 1500.5]) {
		const result = Config["~standard"].validate({ refreshMs: bad });
		assert.ok(result.issues !== void 0 && result.issues.length > 0, `expected reject for ${bad}`);
	}
	assert.equal(Config["~standard"].validate({ refreshMs: 5000 }).value.refreshMs, 5000);
});

function mountContext({ withProjections = true } = {}) {
	const mounted = { installed: null, registered: null, provided: [] };
	const ctx = {
		inject(deps, fn) {
			if (deps[0] === "settings") {
				fn({
					settings: {
						installSection(_ctx, ns, schema, config, hooks) {
							mounted.installed = { ns, schema, config, hooks };
						}
					}
				});
				return;
			}
			if (deps[0] === "sessionProjections" && withProjections) {
				fn({ sessionProjections: { register: (def) => void (mounted.registered = def) } });
			}
		},
		reflect: {
			provide(key) {
				mounted.provided.push(key);
			}
		},
		get() {
			return void 0;
		}
	};
	return { ctx, mounted };
}

test("apply installs the section, registers the projection, mounts the remote", () => {
	const { ctx, mounted } = mountContext();
	apply(ctx, Config["~standard"].validate({}).value);

	assert.equal(mounted.installed.ns, "hover-info");
	assert.equal(mounted.installed.config.active, true);
	mounted.installed.hooks.setSource(() => ({ active: false }));
	mounted.installed.hooks.onChange();

	assert.equal(mounted.registered.key, "hoverInfo");
	assert.equal(mounted.registered.stateVersion, 1);
	assert.equal(typeof mounted.registered.init, "function");
	assert.equal(typeof mounted.registered.apply, "function");
	assert.equal(typeof mounted.registered.wire.view, "function");
	assert.ok(mounted.provided.includes("hoverInfoRemote"), "the remote self-registers");
});

test("a host without a projection registry still installs the section", () => {
	const { ctx, mounted } = mountContext({ withProjections: false });
	apply(ctx, Config["~standard"].validate({ active: false }).value);
	assert.equal(mounted.installed.config.active, false);
	assert.equal(mounted.registered, null);
	assert.ok(mounted.provided.includes("hoverInfoRemote"));
});

test("the registered definition survives schema round-trips", () => {
	const def = hoverInfoProjectionDefinition();
	const state = def.init({ createdAt: 7 });
	assert.equal(state.createdAt, 7);
	assert.equal(state.turns, 0);
	const round = def.stateSchema["~standard"].validate(state);
	assert.equal(round.value.turns, 0);
	const view = def.wire.view(state);
	const viewRound = def.wire.viewSchema["~standard"].validate(view);
	assert.equal(viewRound.value.lastContext, null);
});
