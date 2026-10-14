# dsh-hover-information — agent notes

DSH plugin. Fixed names (renaming breaks form/cache identity): plugin id
`hover-info`; profile entry id `hover-info` (the key the configuration form
and the bundle-patch row both go by); locale namespace `hoverInfo`; bundle id
`@comecaramelos/dsh-hover-information` (npm identity per
`~/.dsh/AGENTS.md` — published to npm; live profiles install it from npm).

**Profile exception (permanent).** The `plugin-dev` profile
(`~/.dsh/profiles/plugin-dev`) is the ONLY profile/preset that keeps the local
reference: `link:/home/roberto/dev/dsh/dsh-hover-information` + symlink under
its `node_modules/@comecaramelos/`, for source-level development. Every other
profile (live `web`, `headless`, future presets) installs the published npm
package. When cleaning local references for npm installs elsewhere, leave the
`plugin-dev` reference and symlink untouched. See
`~/.dsh/profiles/plugin-dev/README.md` + `AGENTS.md` (profile guidance loaded
for sessions on that profile).

The full design lives in `docs/PLAN.md` and the final contract in
`docs/SPEC.md`. Keep PLAN coherent; if an implementation revises a plan
finding, append an "Incremento implementado" note rather than silently
diverging. The metrics block + `hoverInfo` projection unit + `hoverInfo`
Typert remote landed in earlier increments (PLAN §15); the configuration
surface moved onto the dsh 0.2.0 profile configuration form in PLAN §36.

## Architecture in one line

Sources live in `src/host/**` + `src/client/**` and are compiled by
`npm run build` into `lib/**` (the published/consumed tree — `lib/` is build
output, never hand-edit). The public face of the host half is `src/index.ts`,
which re-exports only; the wiring lives in `src/host/apply.ts`, which attaches
the bundle row's own configuration form, registers the `hoverInfo` projection
unit (`src/host/projection/**`, a pure fold of one session's durable log) and
mounts the `hoverInfo` Typert remote (`src/host/remote/**`, endpoints
`POST /api/hoverInfo/{sessions,stats}`). Since dsh 0.2.0 the browser
half reads and writes the row's own configuration through
`configForms.get("hover-info")` — there is no settings namespace and no
`settings.yaml` — and it registers the Plugins page's `plugins.bundle.config`
slot keyed by the package name, so the form stands **on the bundle's own page**
(the one the Plugins list opens, like the built-in Web search entry), not in a
Settings card and not one step further in, on the `hover-info` row's page. The browser half (`src/client/**`, emitted by
`scripts/build-client.mjs` as ONE lazy-CJS
`window.__ModuleLoader__.load` bundle at `lib/client.js`) watches
`document.body` for the stock hover-card portal, injects copy-id / copy-path
icons and a metrics block — resolving identity from the browser `sessions`
store (`list.getSnapshot().byId`) + fiber fast-path, and metrics from the live
`connection.rpc` → `hoverInfo/stats` endpoint or, when the host does not have
that session loaded, the cached `hoverInfo` projection the store row already
carries (cached per session by `refreshMs`). It also overwrites
the composer model-selector's tooltip (the seat trigger + the open menu's root
cells) with `${provider} > ${model}`, resolved from the `ModelSelect` fiber's
`directory` store (DOM fallback only while the model list is open) and gated
by the `showModelProvider` setting (its own catalog block on the row's
configuration page: off restores the stock `title` live, on re-seats it).
The sidebar-preview header tools and the background-job kill buttons this
plugin used to grow are **shell-native since dsh 0.2.0** — both halves are
removed, not disabled (PLAN §39).

## Rules that must not regress

- **Structural detection only.** Never match `*.hoverContent` /
  `*.sessionRow` CSS-module classes; they are hash-prefixed and version
  stable only per build. Fingerprint = `body` child, `position: fixed`,
  244 px, numeric `left`/`top`, ≥2-child flex-column stack. If DSH changes
  card metrics, that is a §13 checklist item, not something to hard-code.
- **Fail-open everywhere.** No match, unresolved ambiguous title, missing
  store/locale, or a non-session card → inject nothing and leave the stock
  card (title-copy, workspace path copy) untouched.
- **Session identity**: fiber fast-path (`SessionHoverContent` prop `node.id`)
  first, DOM title+time-label fallback second; ambiguous DOM matches resolve
  only via a localized relative-time label tie-break, otherwise skip.
- The neutralization of the stock whole-card title copy applies **only** to
  cards this plugin resolves; `role`/`tabindex` removal and click/keydown
  swallowing are per-card DOM operations, never global monkey-patching
  (never patch `HoverCard` — its reference is closed over in the shell
  bundle).
- **Handing a card back belongs to the unmount, not to a switch.** There is no
  master `active` toggle: since dsh 0.2.0 the Plugins page answers whether this
  bundle runs by its own row, so disabling the row takes `apply` out — that is
  the off (PLAN §40), and a configuration switch saying the same thing only
  disagrees with it. `stripCard` (in `enhancer/hover-card.ts`) therefore runs
  from the enhancer's `dispose`: injected nodes out, the stock lines
  `rebuildTimeWrap` folded in re-seated at their pristine indices,
  `role`/`tabindex`/`cursor` restored, the per-card listeners detached. A stock
  line the shell re-rendered behind us is never re-seated (that would duplicate
  it).
- **Never address a stock card line by child index.** `rebuildTimeWrap` locates
  the time line by its relative-time text shape and the status glyph by the
  first `[data-state]` node in the lines that FOLLOW the title/time lines (the
  stock `StateDot` renders as `<span class="_dot_*" data-state="done"
  style="width:10px;height:10px">` — an **svg probe finds nothing**; `svg`
  stays only as fallback) — always on the **pristine** stack, before any
  `dhi-*` node is inserted (an injected node shifts every index; that silent
  shift is why no glyph was ever cloned).
- **Every stock status line folds into the icon.** The lines themselves are
  removed (`statusLines[i].remove()`) and their labels (`Idle`, `Running`, …)
  join, `" · "`-separated, into the clone's `title`/`aria-label` — so the dot
  reads once and the status text survives only as its accessible name. The
  clone drops the source's `aria-hidden` for that to be meaningful; an
  `aria-hidden` clone carrying an `aria-label` is a no-op for screen readers.
- **Composer model-selector tooltip** (PLAN §33): overwrite the seat trigger
  (`button[class$="_trigger"]` inside `div[data-slot="conversation.input.model"]`)
  and the open menu's `button[class$="_cell"][role="menuitem"]` cells with
  `${provider} > ${model}`. Detect structurally (hashed component classes
  matched only by component-name suffix, never a hash prefix) — the menu's
  localized `aria-label` is NOT consulted. Source: the `ModelSelect` fiber's
  `directory` store (`getSnapshot().current` + `groups` display names) first;
  while the model-list pane is open fall back to the DOM (`aria-checked="true"`
  option in its provider-grouped `section[role="group"]`); then — and this is
  the live-shape fix — the **composer source**: the selection resolved once
  per sync pass from a live seat's trigger (the only anchor whose fiber
  return-chain reliably reaches `directory`). A portal menu cell's OWN chain
  never reaches it and the DOM source is invisible while the list is closed,
  so without this third source only the trigger ever resolved live. The store
  **subscription** has the same anchor trap: the `ModelSelect` component that
  carries `directory` renders *inside* the `data-slot` seat, so the seat
  element's own return chain answers nothing — subscribe through the seat's
  **trigger** (whose chain does reach it), with the seat as fallback, or no
  subscription is ever registered and a switch that moves no DOM attribute
  never resyncs. Nothing resolvable → leave the stock `title` untouched
  (fail-open). Writes are diff-only and
  capture the DOM's stock `title` (or absence) for restore; off (or this half
  unmounting) restores everything.


## Layout

- `src/index.ts` — the host half's public face: re-exports only (`apply`,
  `Config`/`ConfigValues`, `inject`/`name` (inject is empty: nothing resolves
  eagerly), `hoverInfoEntryId`, `hoverInfoProjectionDefinition`,
  `HoverInfoRemote`, fixed identifiers, types). The wiring itself is
  `src/host/apply.ts`: the row's configuration-form attach (`src/host/settings.ts`
  — `@comecaramelos/dsh-ancesters`' `attachSettingsForm` over `CONFIG_FIELDS`,
  `liveKeys: []`: the entry-id rule and `settings.configure({ auto: false }, fiber)`
  inside one fiber effect live there) + projection registration + `new HoverInfoRemote(ctx)` (no
  `ctx.provide` for the Service — its constructor self-registers; namespace
  `hoverInfo`). Nothing routes commits: no host consumer reads the config, so
  an edit changes what the browser renders and nothing the host answers.
- `src/host/projection/{state,fold,index}.ts` — the `hoverInfo` projection
  fold (pure, synchronous: state schemas, event fold, definition). Its
  `stateSchema` / `wire.viewSchema` must be **zod** (`import { z } from
  "zod"`, `.nullable()` idiom — no `z.const`, no `z.dict`): the projection
  registry drives them with `schema.parse(...)`, which only zod exposes —
  schemastery-built projection schemas crash every session projection with
  `def.wire.viewSchema.parse is not a function` and kill the `/` slash-command
  menu (it projects every session for `commands/list`/`skills/list`).
  The fold itself is `fold.ts`; `state.ts` holds the zod schemas (which is why
  they must be zod — see below); `index.ts` assembles
  `hoverInfoProjectionDefinition()`.
- `src/host/remote/{index,services,sessions,stats}.ts` — `index.ts` is the
  `TypertRemoteService` subclass with a **manual**
  prototype descriptor (no `@Remote` decorators: the gateway's
  `remoteMethods()` reads the prototype own-property
  `{ version: 1, methods: [...] }`, so no decorator syntax is needed —
  neither the JS form, which is a SyntaxError on plain Node 24, nor the TS
  form). Resolve host
  services through `ctx.get("sessions")` / `ctx.get("sessionProjections")`,
  never `ctx.<name>` property access: on this Service fiber those properties
  are not injected and access throws `cannot get property "..." without
  inject`. (The `static inject` list is documentation only here.)
  The domain failure codes this remote throws are merged into
  `RemoteErrorDetailsMap` by a `declare module` block in `index.ts`, so the
  typed constructor accepts them and the wire `code` stays stable. The
  sessions/stats computation lives in `sessions.ts`/`stats.ts`, and service
  resolution lives in `services.ts` (all through `ctx.get`, same rule as
  above). The kill endpoint the background-job buttons used to call is gone
  (PLAN §39) — this remote answers `sessions` and `stats` only.
- `src/client/**` — browser half, one `__ModuleLoader__.load` bundle emitted
  from `src/client/index.ts`: `index.ts` (`apply` + `inject` + budgets, and the row
  card: the `mountSettingsCard` descriptor from `@comecaramelos/dsh-ancesters/client`,
  which owns the styles → locales → controller → slot registration;
  `placement: "bundle"` puts it in `plugins.bundle.config` keyed by the package
  name; `build-client.mjs` aliases it
  to `client/source` and bundles it in), `plugin-meta.ts`/`constants.ts`
  (mirrored identifiers — it cannot import `src/host/constants.ts`; the entry
  id doubles as the configuration form's key),
  `metrics.ts` (`METRICS` table + formats), `locales/{index,en-US}.ts`,
  `styles/{index,hover-card,card}.ts` (literal `dhi*` class names; the sheets
  travel as strings and are DOM-checked per document — CSS-module scoping would
  hash the very names the structural DOM checks read),
  `card/{body,field-row,fields}.ts` (the card's one declared block: `bindBody`
  projects the ancesters `CardSnapshot` — `values` + `overridden` — into the
  fields and composes the write doors over the shared `CardController`;
  `writeField` / `resetField` / `stage` for the refreshMs draft), and `enhancer/**` (detect/lines/fiber/identify/time/host/
  stats/copy/metrics-block/hover-card/model + the per-mount `env.ts` and mount
  `index.ts`). `connection.rpc.call("/api", "hoverInfo/stats", { args })`.
  The document-preview and background-job halves that used to live here are
  gone — both affordances are shell-native since dsh 0.2.0 (PLAN §39) — so
  the enhancer owns exactly two surfaces: the hover card and the composer
  model selector.
  Metrics have two sources: the live `stats` fetch (authoritative, but it only
  answers while the host has that session loaded) and, when no live view is
  held, the `hoverInfo` value the browser's own session-list row already
  carries (`byId[id].projectionValues.hoverInfo` — zero extra IO, and what
  keeps cold-start cards populated). A settled live answer is cached for
  `refreshMs`; a *failed* attempt retries after `min(refreshMs,
  FAILURE_RETRY_MS = 3000)` rather than a whole TTL. The 1 s sweep heartbeat is
  lazy: started with the first open card, stopped with the last, `unref`'d
  defensively (Node/timer handles only). The card body is restructured into
  ONE header row (`.dhi-twrap`): left `.dhi-lead` = cloned status glyph + the
  relative-time text, right `.dhi-bar` = the two copy buttons — one line, so
  the glyph and the label read in line with the icons (the buttons no longer
  sit `absolute` over the title, and the title no longer needs a right inset).
  The row is the card's FIRST line — it sits ABOVE the title (the stock title
  line keeps the second slot). The title line is the first stock line and is
  marked `data-hi-title`; the injected CSS pins `[data-hi-session]
  [data-hi-title]{font-size:16px}` and `.dhi-twrap` carries `font-size:12px`,
  sizes never applied inline and never via the hash-prefixed class. The
  row-configuration body composes TWO `dhiCard_catalog` blocks in the
  reference (`dsh-chrome-mcp`) row-page shape: catalog 1 carries the
  `showModelProvider` switch (the composer model-selector tooltip) as its own
  two-row field (`.field` = `.fieldRow` title +
  switch inline, `.fieldDesc` hint below — badge + reset ride the row between
  title and switch); catalog 2 stacks the 13 metric toggles in a TWO-COLUMN
  grid filled column-major (`grid-auto-flow: column` over an inline
  `grid-template-rows: repeat(ceil(n/2), auto)`, DOM order stays `METRICS`
  order) above the refresh-interval field (title + inline input in the row,
  hint — or the invalid message — below). The seam rule lives on
  `.catalog + .catalog` only — the page already opens the first block with its
  own top rule, so no catalog adds a second one; `ensureCardCss` is DOM-checked per document —
  never re-introduce a module-level "already injected" flag, it breaks a
  second document's styles.
- `test/client.test.mjs` + `test/dom.mjs` — hand-rolled DOM stubs, no jsdom;
  `store(byId)` mirrors `sessions.list.getSnapshot()`, `makeForm` mirrors
  the served configuration form (snapshot + `mutate` door), `connection.rpc` stub for stats.
- `test/host.test.mjs` / `test/unit.test.mjs` / `test/remote.test.mjs` —
  host wiring, fold table, remote formulas with fake ctx.
- `docs/PLAN.md` — design + "Incremento implementado" notes (§14, §15, §36,
  §39, §40);
  `docs/SPEC.md` — final contract. Read §2/§6/§8 before touching the
  enhancer.

## Deploy / verify

- **Runtime imports live in `dependencies`, never peer/devDeps** (PLAN §15
  packaging deviation). The live profile installs the published npm package
  (pnpm), which only materializes `dependencies`; `lib/index.js →
  lib/host/remote/index.js` importing `@deepseek-ai/dsh-typert-protocol` from a
  peer/devDeps-only declaration throws `ERR_MODULE_NOT_FOUND` while loading
  the bundle and `dsh web` never starts. Everything the host half imports
  (`zod`, `schemastery`, `dsh-typert-protocol`, `cordis`) belongs in
  `dependencies`; only `react`/`react-dom` (browser bundle + tests) and
  `typescript`/`@types/node` (build only) stay in devDeps.
- Live profile (`~/.dsh/profiles/web`) is a pnpm tree: it consumes the
  published npm package — `"@comecaramelos/dsh-hover-information": "^x.y.z"`
  in `dependencies` + a `dsh.profile.bundles` entry; no `file:` dep, no
  symlink there (recipe below). Only the `plugin-dev` profile keeps the local
  `link:` reference (see the profile exception at the top). Never restart the
  running `dsh web`; the user restarts the GUI after deploy.
- Isolated checks: `npm test`, plus the `DSH_HOME` fixture boot below
  (`--dump-config | grep -A5 hover-info`, `--port 0` boot).

### Develop

```sh
npm install        # typescript + @types/node + esbuild land in devDeps
npm run build      # tsc (host) + tsc -p src/client/tsconfig.json + esbuild (browser)
npm test           # builds first, then node --test over the built lib/**
```

- Two halves, two shapes. The host half (`src/index.ts` + `src/host/**`)
  compiles via `tsconfig.json` (`NodeNext` + `strict` + `declaration`) so host
  consumers type against `lib/**/*.d.ts`. The browser half is checked by
  `src/client/tsconfig.json` (`ESNext` + `DOM`, deliberately loose
  (`strict: false`, `noImplicitAny: false`) because its `require`s and DOM
  surfaces belong to the shell, not this package) and **emitted** by
  `scripts/build-client.mjs` (esbuild, CJS `format`, `platform: "neutral"`,
  banner/footer wrapping the body inside one
  `window.__ModuleLoader__.load({ id, factory: require ⇒ … })`); esbuild is
  kept from resolving the bundle's `require`s of `react` +
  `react/jsx-runtime` + `@deepseek-ai/dsh-client-*` by the script's
  `external` list.
- `lib/` is generated output (gitignored, never hand-edit, never committed).
  Any profile that reaches the source tree through a symlink (`plugin-dev`'s
  `link:`) reads the **built** `lib/`, so run `npm run build` before letting
  a profile link a fresh checkout — a stale `lib/` shows up as the previous
  build's behavior, not as a missing file.
- The bundle's `*.d.ts`-style surfaces are structural views, not types
  invented for the shell: `src/client/shell-modules.d.ts` describes only the
  two `@deepseek-ai/dsh-client-*` ids the bundle `require`s (they resolve
  inside the running GUI and exist in no local `node_modules`), and `react` /
  `react/jsx-runtime` typecheck through their devDependency `@types/*`. The
  DOM-`require`d service shapes live in `enhancer/host.ts`; the card's come typed
  from `@comecaramelos/dsh-ancesters/client`.
- `npm run dev` watches the **host** half only (`tsc --watch`). After editing
  any `src/client/**` source run `npm run build:client` — otherwise the browser
  half stays whatever the last full build left in `lib/client.js`.

### Testing conventions

- Tests are plain `node:assert` scripts (`node test/<name>.test.mjs`) run
  through `npm test`; no test framework, no jsdom.
- `test/client.test.mjs` drives the lazy-CJS bundle through a
  `__ModuleLoader__` stub over a hand-rolled DOM (`test/dom.mjs`): fiber
  fast-path, DOM title fallback, duplicate-title tie-break, workspace-card
  rejection, metrics toggles/formats/cache-TTL/RPC fail-open, re-injection,
  dispose — plus `react-dom/server` renders of the row configuration page (both
  the `summary` line and the `page` body, and the page-owned write door).
- `test/host.test.mjs` covers identity (`inject` is `[]`), the whole-surface
  volatile/default table over `Config`, the `refreshMs` bounds, the
  entry-id rule (a fiber with no profile entry throws) and the
  `settings.configure({ auto: false }, fiber)` attach — one call per fiber,
  disposed with the instance — plus projection registration and remote mount
  on a fake ctx;
  `test/unit.test.mjs` the fold table (turn dedup, usage sanitization, tool
  pairing + turn-end drop, null context window); `test/remote.test.mjs` the
  descriptor discovery + `sessions()`/`stats()` formulas + typed
  `RemoteError`s.
- Host behavior beyond the fakes is exercised by the isolated boot + RPC smoke
  below, then by the GUI checklist.

### Deploy recipe (live web profile)

The live profile consumes the published npm package — the deploy is just the
manifest entry, materialized by pnpm:

1. `~/.dsh/profiles/web/package.json`: dependency
   `"@comecaramelos/dsh-hover-information": "^x.y.z"` (published version)
   **plus** the same name in `dsh.profile.bundles`, after
   `@deepseek-ai/dsh-base` / `@deepseek-ai/dsh-web-app`. No `file:` dep, no
   symlink under `node_modules/@comecaramelos/` — a leftover symlink there
   shadows the installed tree and re-introduces the source checkout.
2. Install inside the profile (`pnpm install`, run by the user) — it lands the
   tarball in `node_modules`, a snapshot in `pnpm-lock.yaml`, and a
   `.modules.yaml` entry; verify all three after.
3. Ask the user to restart/refresh the GUI — client bundles do not hot-update
   in the live profile, and the agent must not restart `dsh web`.

The browser client injects the live services it reads
(`@deepseek-ai/dsh-api-session-controller`,
`@deepseek-ai/dsh-client-connection`,
`@deepseek-ai/dsh-client-locale`, `@deepseek-ai/dsh-client-ui-plugin-manager`,
`@deepseek-ai/dsh-client-ui-settings`) —
all already mounted by the base profile, so deploy stays manifest-only. The
last two matter for configuration: the settings surface hands the row's form,
the plugin-manager half exposes the `plugins.bundle.config` slot the body
renders into. Both stay listed for a hard reason, not hygiene: the slot's
`locale: "hoverInfo"` is what answers `props.t` (`localeSeat(face,
entry.locale)`), and the renderer raises a slot-assembly error when no locale
face is installed — dropping `dsh-client-locale` takes the whole configuration card out,
not just its strings.

For source-level iteration use the `plugin-dev` profile (its `link:` +
symlink is the permanent local-reference exception, see the profile note at
the top); never copy that local reference back into the live profile.

### Isolated boot check (no live profile involved)

```sh
rm -rf /tmp/dsh-hi-home
npm run build   # the fixture reaches this tree through a symlink; lib/ must exist
mkdir -p /tmp/dsh-hi-home/profiles/verify/node_modules/@comecaramelos
ln -s $PWD /tmp/dsh-hi-home/profiles/verify/node_modules/@comecaramelos/dsh-hover-information
printf '%s\n' '{' '  "name": "dsh-profile-verify", "private": true,' \
  '  "dependencies": { "@comecaramelos/dsh-hover-information": "file:'$PWD'" },' \
  '  "dsh": { "profile": { "bundles": [' \
  '    "@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app",' \
  '    "@comecaramelos/dsh-hover-information" ] } }' '}' \
  > /tmp/dsh-hi-home/profiles/verify/package.json
echo '[]' > /tmp/dsh-hi-home/profiles/verify/cordis.yml
echo '[]' > /tmp/dsh-hi-home/profiles/verify/cordis.patch.yml
DSH_HOME=/tmp/dsh-hi-home dsh --profile verify --dump-config | grep -A5 hover-info
```

The row must come out as `id: hover-info` — that id is what the configuration
form and the row page both resolve by, so a dump that keys it by the package
name means the patch row lost its `id`.

### End-to-end remote check with no live sessions

From the fixture above (keep `/tmp/dsh-hi-home`, then):

```sh
(DSH_HOME=/tmp/dsh-hi-home nohup \
  dsh --profile verify --no-open --port 0 > /tmp/dsh-hi-boot.log 2>&1 &)
sleep 5
URL=$(grep -o 'http://[^/]*/[^ ]*' /tmp/dsh-hi-boot.log | head -1)
TOKEN=${URL#*token=}
curl -s -c /tmp/hi-cookies.txt "${URL%%token=*}?token=$TOKEN" > /dev/null
curl -s -b /tmp/hi-cookies.txt -X POST "${URL%%token=}api/hoverInfo/sessions" \
  -H 'Content-Type: application/json' \
  --data '{"type":"client-request","rpcId":"smoke-1","method":"hoverInfo/sessions","payload":{"args":{}}}'
# → {"type":"server-response","rpcId":"smoke-1","result":{"ok":true,"value":[]}}
curl -s -b /tmp/hi-cookies.txt -X POST "${URL%%token=}api/hoverInfo/stats" \
  -H 'Content-Type: application/json' \
  --data '{"type":"client-request","rpcId":"smoke-2","method":"hoverInfo/stats","payload":{"args":{"sessionId":"nope"}}}'
# → {"result":{"ok":false,"error":{"code":"hoverInfo/session-not-found",…}}}
```

(The index route's `?token=` only mints the signed session cookie on `GET /`,
so the RPC smoke must reuse that cookie.)

### Configuration form check (same fixture)

The row's own form must be **served** by the Host and **writable**. From the
boot above (cookie already minted; `BASE` is the origin, no token):

```sh
curl -s -b /tmp/hi-cookies.txt -X POST "${BASE}api/settings/describe" \
  -H 'Content-Type: application/json' \
  --data '{"type":"client-request","rpcId":"cfg-1","method":"settings/describe","payload":{"args":{}}}' \
  | python3 -c "import json,sys;v=json.load(sys.stdin)['result']['value'];\
      n=[x for x in v['namespaces'] if x['ns']=='hover-info'][0];\
      print(n['autoGenerate'], n['applies'], n['revision'], len(n['schema']['refs']), n['user'])"
# → False live 0 16 {}   (autoGenerate false = the generated page stays off;
#   16 = the root Config ref + the 15 volatile fields)
curl -s -b /tmp/hi-cookies.txt -X POST "${BASE}api/settings/mutate" \
  -H 'Content-Type: application/json' \
  --data '{"type":"client-request","rpcId":"cfg-2","method":"settings/mutate","payload":{"args":{"ns":"hover-info","ops":[{"op":"set","path":["showModel"],"value":false}]}}}'
# → {"result":{"ok":true,"value":{"ns":"hover-info","revision":1,
#     "user":{"showModel":false}, …}}}
```

One op answers exactly ONE user-layer key. If an untouched field turns up
alongside an unrelated op, something pinned that default in the row patch's own
`config:`
(GUI checklist item 8) — the bundle patch here declares id + name only, and a
host test guards it.


A `false` from `mutate` is **not** an error path to swallow: the client form
recovers by reloading the Host document (that is why the ancesters `CardController` reissues a
refused pass, `MAX_WRITE_PASSES = 4`). Writing persists into the profile's own
patch document — `profiles/verify/cordis.patch.yml` grows `id`/`name`/`config`
— so a bundle-patch row is writable and a save check against `bundles:` proves
saving (an earlier belief that any patch row refuses writes was measured wrong:
what refuses is a field pinned **above** the document, a `--patch` overlay
answering `Configuration for "hover-info" is overridden by a home patch or
command-line overlay` with `settings/rejected`, per field, never page-wide).
`{op:"unset"}` behaves the same and answers the field's base layer back.

## GUI checklist (needs a live `dsh web`)

1. Hover a session row → card appears within ~500 ms; the card's ONE header
   row — the FIRST line, above the title (title text 16px, header row 12px) —
   carries status glyph + "X time ago" on the left and the two copy icons
   on the right, all in line; NO stock `dot + label` status line is left below
   it — the label is the glyph icon's tooltip/accessible name; no pointer
   cursor; clicking the body no longer copies the title.
2. Copy ID → full session id; Copy path → absolute workspace path; check
   mark 1.3 s.
3. Duplicate titles: one match → icons; ambiguous → stock card, no console
   noise beyond one warn at most.
4. Workspace (project) card keeps its stock copy-path behavior.
5. Metrics block appears under the stock lines with the defaults (turns,
   steps, tokens in/out, compactions, purges, context, subagents, model) and
   formats applied; toggling a metric on the Plugins page's own row
   configuration page updates open cards <1 s.
6. Disabling the bundle row (the only off there is) → stock card everywhere,
   **including a card that is already open**: the enhancer's unmount hands its
   injections and its folded stock lines back to the shell, and re-enabling the
   row re-seats the same card on the next hover. There is no `active` switch to
   flip — it answered the same question the row's own enable answers (PLAN §40).
7. A session with neither a live host entry nor cached `hoverInfo` projection
   values (or the endpoint absent) → stock card, at most one console debug
   line. A session that is only cached (the cold-start case) must still render
   its metrics block from the row's projection values.
8. Plugins page → click this bundle in the list: its page opens with the
   configuration right there (no step into the `hover-info` component; the
   component row still lists below it, with no configure link of its own). The
   page's description line is the package description — never
   whether it runs (the bundle's own enable answers that); inside the page
   detail, TWO catalog blocks separated by a hairline
   seam (the page owns the container, the title and the description — no
   collapsible card shell, no chevron); catalog 1 = the
   `showModelProvider` composer model-selector switch as its own two-row field
   (title + switch inline, hint below); catalog 2 = the 13 metric toggles forming TWO COLUMNS
   filled top→bottom per column (left 7 /
   right 6, DOM order stays `METRICS` order) above the refresh-interval field
   (title + inline input, hint below); Overridden badge + reset per field, and
   only on the fields actually edited; invalid refreshMs drafts never write; a
   field pinned above the patch document (a `--patch` overlay) refuses its write
   and snaps the control back; only a profile that answers form edits as
   read-only grows the read-only note. Nothing here may pin a default in the row
   patch's own `config:` — the Host folds that layer into every later write, so
   an untouched field would read Overridden for no edit of its own (measured;
   guarded by a host test).
9. Composer model selector (only while the `showModelProvider` switch is on):
    hover the composer's model-selector trigger → tooltip reads
    `Provider > Model` (e.g. `OpenRouter > GPT-5`), not the shell's
    `Model · Effort`; open the selector menu → the two root cells (Model /
    Effort row) carry the same `Provider > Model` tooltip, **and** the Model
    row's visible value (the `cellValue` span) now reads `Provider > Model`
    whichever stock shape the shell rendered — the bare model name, or its own
    `provider/model` pairing. The Effort row's value is left
    as the shell rendered it (the stock-guard skips it). Switching model (or
    provider) updates both the tooltip and the visible value immediately
    without a DOM attribute change (the directory-store subscription drives
    it; the shell's render of the current value is recaptured before
    re-pairing). Toggling `showModelProvider` off
    restores both the shell's original tooltip and the value it was rendering
    live, with no reload; toggling back re-seats both. Disabling the bundle row
    hands the whole selector surface back with it (the enhancer's unmount
    restores every managed `title`). A session with no
    resolvable selection (no fiber source, model list never opened) leaves
    the shell's stock tooltip untouched (fail-open).
