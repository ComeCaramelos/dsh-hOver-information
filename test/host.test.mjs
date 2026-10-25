/**
 * Host-half tests: plugin identity, the configuration-form surface every field
 * of the row config must present, and the apply() wiring (configuration form +
 * projection registration + remote mount) against fake host faces. No live
 * composition, no network.
 *
 * The form surface is pinned from the *compiled* shape rather than from the
 * source because the failure it guards against is invisible in the source: a
 * field a page edits is reachable only when it is declared `.volatile()` on the
 * row `Config`. An entry declaring no volatile field answers no form at all
 * (`Plugin entry "<id>" has no volatile fields`), and a write naming a
 * non-volatile field is refused Host-side (`Config field "<path>" is not
 * volatile`) — either failure looks like a dead page, and neither is caught by
 * reading the plugin's own fields.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { apply, Config, CONFIG_FIELDS, hoverInfoEntryId, hoverInfoProjectionDefinition, inject, name } from "../lib/index.js";

/** Field name → field type, read out of the compiled form surface. */
function fieldTypes(config) {
    const compiled = config.toJSON();
    const refs = compiled.refs ?? {};
    // The root `dict` maps every field name to its compiled type.
    const root = Object.values(refs).find((entry) => entry && typeof entry.dict === "object" && entry.dict !== null && Object.keys(entry.dict).length > 5);
    assert.ok(root, "Config did not compile to a keyed shape");
    const out = new Map();
    for (const [field, ref] of Object.entries(root.dict)) out.set(field, refs[ref] ?? {});
    return out;
}

/** Everything the row page edits, with the defaults docs/PLAN.md §4 pins. */
const SURFACE = [
    ["showModelProvider", true],
    ["refreshMs", 30000],
    ["showTurns", true],
    ["showSteps", true],
    ["showTokensIn", true],
    ["showTokensOut", true],
    ["showCompactions", true],
    ["showPurges", true],
    ["showContext", true],
    ["showSubagents", true],
    ["showModel", true],
    ["showToolCalls", false],
    ["showActiveTime", false],
    ["showCacheRead", false],
    ["showCreatedAt", false]
];

test("plugin identity", () => {
    assert.equal(name, "hover-info");
    // Nothing is injected eagerly: the form attaches inside one fiber effect (the
    // only place its disposer can leave with the instance), the projection
    // registry and the remote resolve lazily, and an eager list would risk the
    // load-order cycle for services that are never needed before `apply`.
    assert.deepEqual(inject, []);
});

test("every field of the row config is served as a configuration form", () => {
    const fields = fieldTypes(Config);
    const names = [...fields.keys()].sort();
    assert.deepEqual(
        names,
        SURFACE.map(([field]) => field).sort(),
        `expected ${SURFACE.length} fields, got ${names.length}`
    );
    for (const [field, expected] of SURFACE) {
        const type = fields.get(field) ?? {};
        assert.equal(type.meta?.volatile, true, `field "${field}" is not volatile, so the page could not write it`);
        assert.equal(type.meta?.default, expected, `field "${field}" no longer answers its documented default`);
    }
    assert.deepEqual(
        names.filter((field) => fields.get(field)?.meta?.volatile !== true),
        [],
        "every field is what the browser half edits, so a plain field would refuse its write Host-side"
    );
});

test("CONFIG_FIELDS names every field of the row config, in schema order", () => {
    // The form routes exactly these as user-authored: a schema field missing
    // here would be an edit the host never hears about.
    assert.deepEqual([...CONFIG_FIELDS], [...fieldTypes(Config).keys()]);
});

test("refreshMs bounds reject out-of-range and fractional values", () => {
    for (const bad of [999, 60001, 1500.5]) {
        const result = Config["~standard"].validate({ refreshMs: bad });
        assert.ok(result.issues !== void 0 && result.issues.length > 0, `expected reject for ${bad}`);
    }
    const accepted = Config["~standard"].validate({ refreshMs: 5000 });
    assert.equal(accepted.issues, void 0);
    // A volatile field answers as a reference, not a scalar — that is exactly why
    // `apply` never consumes it (the browser reads the form instead).
    const value = accepted.value.refreshMs;
    assert.equal(typeof value === "object" ? typeof value.get === "function" ? value.get() : value : value, 5000);
});

/**
 * A fake host face: one fiber carrying the loader entry the entry-id rule reads,
 * an `inject` that hands out the two services the halves resolve lazily, and a
 * `settings` answering the dsh 0.2 form surface (`describe`/`configure`/`mutate`,
 * which dsh-ancesters checks by shape) whose `configure` records every
 * presentation (and counts whether it left with the fiber).
 */
function mountContext({ withProjections = true, entryId = "hover-info" } = {}) {
    const mounted = { configured: [], registered: null, provided: [], warnings: [], errors: [], effects: 0, disposers: [] };
    const ctx = {
        fiber: entryId === null ? {} : { entry: { options: { id: entryId } } },
        effect(execute) {
            mounted.effects++;
            const dispose = execute();
            if (typeof dispose === "function") mounted.disposers.push(dispose);
            return () => dispose?.();
        },
        logger: {
            warn(message) {
                mounted.warnings.push(String(message));
            },
            error(message) {
                mounted.errors.push(String(message));
            },
            info() {},
            debug() {}
        },
        inject(deps, fn) {
            if (deps[0] === "settings") {
                fn({
                    settings: {
                        describe() {
                            return [];
                        },
                        mutate() {
                            return Promise.resolve(true);
                        },
                        configure(presentation, owner) {
                            const record = { presentation, owner, disposed: false };
                            mounted.configured.push(record);
                            return () => {
                                record.disposed = true;
                            };
                        }
                    }
                });
                return;
            }
            if (deps[0] === "sessionProjections" && withProjections) {
                fn({ sessionProjections: { register: (definition) => void (mounted.registered = definition) } });
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

test("hoverInfoEntryId reads the key off this instance's own loader entry", () => {
    assert.equal(hoverInfoEntryId({ fiber: { entry: { options: { id: "hover-info" } } } }), "hover-info");
    // No entry id means no form: inventing a key would address a row that stands
    // for nothing, so the rule says it out loud instead.
    assert.throws(() => hoverInfoEntryId({ fiber: {} }), /not a profile entry/);
    assert.throws(() => hoverInfoEntryId({}), /not a profile entry/);
    assert.throws(() => hoverInfoEntryId({ fiber: { entry: { options: { id: "" } } } }), /not a profile entry/);
});

test("apply attaches the form, registers the projection, mounts the remote", () => {
    const { ctx, mounted } = mountContext();
    apply(ctx);

    assert.equal(mounted.configured.length, 1, "exactly one configure per fiber (a second throws)");
    assert.deepEqual(mounted.configured[0].presentation, { auto: false }, "the generated page stays off while the row owns its page");
    assert.equal(mounted.configured[0].owner, ctx.fiber, "the presentation belongs to this fiber");

    assert.equal(mounted.registered.key, "hoverInfo");
    assert.equal(mounted.registered.stateVersion, 3, "v3 re-folds the whole-prompt context sample (v2 added the `purges` fold); the bump forces already-checkpointed sessions to refold the full log");
    assert.equal(typeof mounted.registered.init, "function");
    assert.equal(typeof mounted.registered.apply, "function");
    assert.equal(typeof mounted.registered.wire.view, "function");
    assert.ok(mounted.provided.includes("hoverInfoRemote"), "the remote self-registers");

    for (const dispose of mounted.disposers) dispose();
    assert.equal(mounted.configured[0].disposed, true, "disposal leaves no presentation configured");
});

test("a non-profile instance states it once and keeps every other half", () => {
    const { ctx, mounted } = mountContext({ entryId: null });
    apply(ctx);
    assert.equal(mounted.configured.length, 0, "no entry id, so no page to turn off");
    assert.equal(mounted.errors.length, 1, "stated loudly once, not on every effect");
    assert.match(mounted.errors[0], /not a profile entry/);
    assert.equal(mounted.registered.key, "hoverInfo");
    assert.ok(mounted.provided.includes("hoverInfoRemote"));
});

test("a host without a projection registry still attaches the form", () => {
    const { ctx, mounted } = mountContext({ withProjections: false });
    apply(ctx);
    assert.equal(mounted.registered, null);
    assert.equal(mounted.configured.length, 1);
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

test("the shipped bundle patch pins no config layer on the row", () => {
	const patch = readFileSync(new URL("../cordis.patch.yml", import.meta.url), "utf8");
	const lines = patch.split("\n");
	const start = lines.findIndex((line) => line.includes("- id: hover-info"));
	assert.ok(start >= 0, "the shipped patch declares the row by its entry id");
	const body = [];
	for (const line of lines.slice(start + 1)) {
		if (line.trim() !== "" && !line.startsWith(" ")) break;
		body.push(line);
	}
	assert.ok(body.some((line) => line.includes("hover-information")), "the row keeps its package name");
	// A pinned `config:` here is the document's OWN base, so the Host folds it
	// into every later write as a user-layer value — measured live: one
	// unrelated toggle answered a pinned default alongside it, and the toggles
	// started reading Overridden for no edit of their own. Defaults belong
	// in the Config schema (docs/PLAN.md §36).
	assert.equal(
		body.some((line) => /^\s+config:/.test(line)),
		false,
		"no config layer — it would come back as a bogus Overridden override"
	);
});
