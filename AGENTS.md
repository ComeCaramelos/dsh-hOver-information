# dsh-hover-information — agent notes

DSH plugin. Fixed names (renaming breaks cache/namespace): plugin id
`hover-info`; settings namespace `hover-info`; locale namespace `hoverInfo`;
bundle id `@comecaramelos/dsh-hover-information` (npm identity per
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
Typert remote + Settings card landed in this increment — their deviations
from PLAN are recorded in PLAN §15.

## Architecture in one line

Sources live in `src/host/**` + `src/client/**` and are compiled by
`npm run build` into `lib/**` (the published/consumed tree — `lib/` is build
output, never hand-edit). The public face of the host half is `src/index.ts`,
which re-exports only; the wiring lives in `src/host/apply.ts`, which installs
the `hover-info` settings section, registers the `hoverInfo` projection unit
(`src/host/projection/**`, a pure fold of one session's durable log) and
mounts the `hoverInfo` Typert remote (`src/host/remote/**`, endpoints
`POST /api/hoverInfo/{sessions,stats,killJob}`). The browser half (`src/client/**`,
emitted by `scripts/build-client.mjs` as ONE lazy-CJS
`window.__ModuleLoader__.load` bundle at `lib/client.js`) watches
`document.body` for the stock hover-card portal, injects copy-id / copy-path
icons and a metrics block — resolving identity from the browser `sessions`
store (`list.getSnapshot().byId`) + fiber fast-path, and metrics from the live
`connection.rpc` → `hoverInfo/stats` endpoint or, when the host does not have
that session loaded, the cached `hoverInfo` projection the store row already
carries (cached per session by `refreshMs`). It also grows two header tools
(copy content / copy path) on the stock document preview, detected only
through its `data-document-preview` / `data-textpreview-path` attributes,
gated by the `showPreviewTools` setting (its own catalog block on the Settings
card: off detaches the injected bar live, on re-seats it). It also overwrites
the composer model-selector's tooltip (the seat trigger + the open menu's root
cells) with `${provider} > ${model}`, resolved from the `ModelSelect` fiber's
`directory` store (DOM fallback only while the model list is open) and gated
by the `showModelProvider` setting (its own catalog block on the Settings
card: off restores the stock `title` live, on re-seats it). It also grows one
kill button on each **live** (`running`/`stopping`) row of the session
header's `JobListAction` background-job list — a `hoverInfo/killJob`
`{sessionId, jobId}` RPC that cancels the job through the host's `jobs`
registry — detected through the menu's localized `aria-label` (ns `job`) and
the row/store identity (fiber `key` per row, `snapshot.jobsBySession[sessionId]`),
never any hashed class, gated by the `showJobKill` setting (its own catalog
block on the Settings card: off detaches the buttons live, on re-seats them)
— settled rows never grow a button (PLAN §34).

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
- **Document-preview tools** (PLAN §21): detect only through the shell's
  stable `data-document-preview` / `data-textpreview-path` attributes, never
  the hashed `*Header`/`*tool` CSS classes. Content source: the renderer's
  fiber `content` prop (exact source, viewer-independent); `eof: false` falls
  back to `workspaceFiles/readAll` (the wire scope id only resolves a
  workspace-root `cwd` — never confines the absolute path requested). No live
  session or failed readAll → copy the loaded pages; byte renderers copy
  nothing.
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
  so without this third source only the trigger ever resolved live. Nothing
  resolvable → leave the stock `title` untouched (fail-open). Writes are
  diff-only and
  capture the DOM's stock `title` (or absence) for restore; off / `active:false`
  restores everything.
- **Background-job kill buttons** (PLAN §34): the row's LIVE vs settled status
  is read ONLY from the live store's `snapshot.jobsBySession[sessionId]` (the
  row DOM is never consulted) — a settled row must grow no button, and a row
  that settles behind us loses its own on the next sync. The menu is anchored
  by its localized `aria-label` (`job` / `list.aria`) — never the hashed
  `*_menu` class (a `QsffPG_*` name is build-scoped); the session id rides the
  menu fiber's `return` chain and the job id each row fiber's `key`
  (positional fallback onto the store order). A kill is NOT a force: the host
  flips the record to `stopping` and lets the row settle, and every failure
  code is treated as a no-op (fail-open). The button is the row's last child
  (`dhi-kill`, `data-hi-jobkill`/`data-hi-job`) — diff-only, one in flight per
  row. `showJobKill: false` / `active:false` detaches every mounted button and
  leaves discovery off.

## Layout

- `src/index.ts` — the host half's public face: re-exports only (`apply`,
  `Config`/`SettingsSchema`, `inject`/`name`, `hoverInfoProjectionDefinition`,
  `HoverInfoRemote`, fixed identifiers, types). The wiring itself is
  `src/host/apply.ts`: `hover-info` settings section + projection registration
  + `new HoverInfoRemote(ctx)` (no `ctx.provide` for the Service — its
  constructor self-registers; namespace `hoverInfo`).
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
- `src/host/remote/{index,services,sessions,stats,jobs}.ts` — `index.ts` is the
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
  sessions/stats computation lives in `sessions.ts`/`stats.ts`, the kill in
  `jobs.ts` (`killJobFor(ctx, sessionId, jobId)` passes the live agent to
  `jobs.kill(id, agent)` — the registry's owner fence demands it), and
  service resolution lives in `services.ts` (all through `ctx.get`, same
  rule as above).
- `src/client/**` — browser half, one `__ModuleLoader__.load` bundle emitted
  from `src/client/index.ts`: `index.ts` surface (`apply` + `inject` + budgets),
  `apply.ts` (dictionaries + card + enhancer), `plugin-meta.ts`/`constants.ts`
  (mirrored identifiers — it cannot import `src/host/constants.ts`),
  `metrics.ts` (`METRICS` table + formats), `locales/{index,en-US}.ts`,
  `styles/{index,hover-card,card}.ts` (literal `dhi*` class names; the sheets
  travel as strings and are DOM-checked per document — CSS-module scoping would
  hash the very names the structural DOM checks read),
  `card/{card,field-row,icons}.ts` + `controller/{index,fields}.ts` (the
  Settings card), and `enhancer/**` (detect/lines/fiber/identify/time/host/
  stats/copy/metrics-block/hover-card/preview/model/jobs + the per-mount `env.ts`
  and mount `index.ts`). `connection.rpc.call("/api", "hoverInfo/stats", { args })`.
  The `enhancer/jobs.ts` half grows one kill button per **live** row of the
  session header's `JobListAction` background-job list (`hoverInfo/killJob`,
  gated by `showJobKill`); settled rows stay stock (PLAN §34).
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
  settings-card body composes FIVE `dhiCard_catalog` blocks in the reference
  card's (`dsh-chrome-mcp`) Settings shape: catalog 1 carries the master
  `active` switch as its own two-row field (`.field` = `.fieldRow` title +
  switch inline, `.fieldDesc` hint below — badge + reset ride the row between
  title and switch); catalog 2 carries the `showPreviewTools` switch (the sidebar file-preview header tools) as its own two-row field, same shape; catalog 3 carries the `showModelProvider` switch (the composer model-selector tooltip) as its own two-row field, same shape; catalog 4 carries the `showJobKill` switch (the background-job kill buttons) as its own two-row field, same shape; catalog 5 stacks the 13 metric toggles in a TWO-COLUMN
  grid filled column-major (`grid-auto-flow: column` over an inline
  `grid-template-rows: repeat(ceil(n/2), auto)`, DOM order stays `METRICS`
  order) above the refresh-interval field (title + inline input in the row,
  hint — or the invalid message — below). The seam rule lives on
  `.catalog + .catalog` only — the body already draws the card's top rule, so
  no catalog adds a second one; `ensureCardCss` is DOM-checked per document —
  never re-introduce a module-level "already injected" flag, it breaks a
  second document's styles.
- `test/client.test.mjs` + `test/dom.mjs` — hand-rolled DOM stubs, no jsdom;
  `store(byId)` mirrors `sessions.list.getSnapshot()`, `makeScope` mirrors
  the bound settings scope, `connection.rpc` stub for stats.
- `test/host.test.mjs` / `test/unit.test.mjs` / `test/remote.test.mjs` —
  host wiring, fold table, remote formulas with fake ctx.
- `docs/PLAN.md` — design + "Incremento implementado" notes (§14, §15);
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
  DOM-`require`d service shapes live in `enhancer/host.ts` / `controller/*`.
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
  dispose — plus a `react-dom/server` render of the settings card.
- `test/host.test.mjs` covers identity, `SettingsSchema` defaults/bounds and
  `installSection` + projection registration + remote mount on a fake ctx;
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
`@deepseek-ai/dsh-client-locale`, `@deepseek-ai/dsh-client-ui-settings`) —
all already mounted by the base profile, so deploy stays manifest-only.

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
   formats applied; toggling a metric in Settings → Plugins updates open
   cards <1 s.
6. `active: false` in the Settings card (or disabling the bundle row) →
   stock card everywhere.
7. A session with neither a live host entry nor cached `hoverInfo` projection
   values (or the endpoint absent) → stock card, at most one console debug
   line. A session that is only cached (the cold-start case) must still render
   its metrics block from the row's projection values.
8. Settings → Plugins card: collapsible, closed by default; FIVE catalog
   blocks separated by hairline seams; catalog 1 = master switch as a
   two-row field (title + switch inline, hint below), catalog 2 = the
   `showPreviewTools` sidebar-preview switch as its own two-row field
   (same shape), catalog 3 = the `showModelProvider` composer model-selector
   switch as its own two-row field (same shape), catalog 4 = the `showJobKill`
   kill-button switch as its own two-row field (same shape), catalog 5 = the
   13 metric toggles forming TWO COLUMNS
   filled top→bottom per column (left 7 /
   right 6, DOM order stays `METRICS` order) above the refresh-interval field
   (title + inline input, hint below); Overridden badge + reset per field;
   invalid refreshMs drafts never write.
9. Open a text file in the sidebar preview → header grows two tool buttons
   (only while the `showPreviewTools` switch is on) next to
   Open-with/wrap/reload (content copy + path copy, check marks
   1.3 s). Copy path → absolute path in clipboard, zero RPC. Copy content on
   a fully loaded file → exact source; on a Markdown preview the SOURCE is
   copied, not rendered text. A byte/PDF preview click copies nothing (one
   debug line only). Toggling the switch on an already-open preview detaches
   / re-seats the bar live (no reload).
10. Close the preview tab / switch away → no leaked observers; the lazy
    heartbeat starts with the first preview/card and stops with the last.
    `active: false` → preview header stays stock.
11. Composer model selector (only while the `showModelProvider` switch is on):
    hover the composer's model-selector trigger → tooltip reads
    `Provider > Model` (e.g. `OpenRouter > GPT-5`), not the shell's
    `Model · Effort`; open the selector menu → the two root cells (Model /
    Effort row) carry the same `Provider > Model` tooltip, **and** the Model
    row's visible value (the `cellValue` span the shell renders as the bare
    model name) now reads `Provider > Model`. The Effort row's value is left
    as the shell rendered it (the stock-guard skips it). Switching model (or
    provider) updates both the tooltip and the visible value immediately
    without a DOM attribute change (the directory-store subscription drives
    it; React's render of the bare model name is recaptured before
    re-pairing). Toggling `showModelProvider` off (or `active: false`)
    restores both the shell's original tooltip and its current bare model
    name live, with no reload; toggling back re-seats both. A session with no
    resolvable selection (no fiber source, model list never opened) leaves
    the shell's stock tooltip untouched (fail-open).

12. Background-job list (only while the `showJobKill` switch is on): open the
    session header's background-job menu → every LIVE row (`running` /
    `stopping`) carries a kill button at its right end (a small ✕ icon,
    `data-hi-jobkill`), settled rows (`completed` / `killed` / `failed`) show
    NOTHING extra; clicking it flips the row to `stopping` (the kill is a
    cancel, not a force) and the row settles as `killed` — the button vanishes
    with the row. A live job that settles behind us loses its button on the
    next sweep (≤1 s). A kill request already in flight ignores extra clicks.
    `showJobKill` off (or `active: false`) detaches every button live and the
    menu stays stock; switching back re-seats them with no reload. A menu
    whose session id cannot be resolved leaves every row stock (fail-open).
