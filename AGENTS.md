# dsh-hover-information — agent notes

DSH plugin. Fixed names (renaming breaks cache/namespace): plugin id
`hover-info`; settings namespace `hover-info`; locale namespace `hoverInfo`;
bundle id `@comecaramelos/dsh-hover-information` (npm identity per
`~/.dsh/AGENTS.md` — never publish, local `file:` + symlink only).

The full design lives in `docs/PLAN.md` and the final contract in
`docs/SPEC.md`. Keep PLAN coherent; if an implementation revises a plan
finding, append an "Incremento implementado" note rather than silently
diverging. The metrics block + `hoverInfo` projection unit + `hoverInfo`
Typert remote + Settings card landed in this increment — their deviations
from PLAN are recorded in PLAN §15.

## Architecture in one line

`lib/index.js` (host) installs the `hover-info` settings section, registers
the `hoverInfo` projection unit (`lib/unit.js`, a pure fold of one session's
durable log) and mounts the `hoverInfo` Typert remote (`lib/remote.js`,
endpoints `POST /api/hoverInfo/{sessions,stats}`). `lib/client.js`
(browser lazy-CJS bundle, zero `require`s) watches `document.body` for the
stock hover-card portal, injects copy-id / copy-path icons and a metrics
block — resolving identity from the browser `sessions` store
(`list.getSnapshot().byId`) + fiber fast-path, and metrics from the live
`connection.rpc` → `hoverInfo/stats` endpoint or, when the host does not have
that session loaded, the cached `hoverInfo` projection the store row already
carries (cached per session by `refreshMs`). It also grows two header tools
(copy content / copy path) on the stock document preview, detected only
through its `data-document-preview` / `data-textpreview-path` attributes.

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

## Layout

- `lib/index.js` — host half: `hover-info` settings section + projection
  registration + `new HoverInfoRemote(ctx)` (no `ctx.provide` for the
  Service — its constructor self-registers; namespace `hoverInfo`).
- `lib/unit.js` — the `hoverInfo` projection fold (pure, synchronous). Its
  `stateSchema` / `wire.viewSchema` must be **zod** (`import { z } from
  "zod"`, `.nullable()` idiom — no `z.const`, no `z.dict`): the projection
  registry drives them with `schema.parse(...)`, which only zod exposes —
  schemastery-built projection schemas crash every session projection with
  `def.wire.viewSchema.parse is not a function` and kill the `/` slash-command
  menu (it projects every session for `commands/list`/`skills/list`).
- `lib/remote.js` — `TypertRemoteService` subclass with a **manual**
  prototype descriptor (no `@Remote` decorators — plain-`.js` decorator
  syntax is a SyntaxError on Node 24; the gateway's `remoteMethods()` reads
  the prototype own-property `{ version: 1, methods: [...] }`). Resolve host
  services through `ctx.get("sessions")` / `ctx.get("sessionProjections")`,
  never `ctx.<name>` property access: on this Service fiber those properties
  are not injected and access throws `cannot get property "..." without
  inject`. (The `static inject` list is documentation only here.)
- `lib/client.js` — browser enhancer + settings card (`__ModuleLoader__.load`
  bundle; `connection.rpc.call("/api", "hoverInfo/stats", { args })`).
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
  sizes never applied inline and never via the hash-prefixed class.
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
  packaging deviation). The live profile installs pnpm over `file:` deps,
  which only materializes `dependencies`; `lib/index.js → lib/remote.js`
  importing `@deepseek-ai/dsh-typert-protocol` from a peer/devDeps-only
  declaration throws `ERR_MODULE_NOT_FOUND` while loading the bundle and
  `dsh web` never starts. Everything the host half imports (`zod`,
  `schemastery`, `dsh-typert-protocol`, `cordis`) belongs in `dependencies`;
  only `react`/`react-dom` (browser bundle + tests) stay in devDeps.
- Live profile (`~/.dsh/profiles/web`) is a pnpm tree on a Windows mount:
  never `npm`/`pnpm install` inside it — `file:` dependency +
  `dsh.profile.bundles` entry + symlink under `node_modules/@comecaramelos/`
  (recipe below). Never restart the running `dsh web`; the user
  restarts the GUI after deploy.
- Isolated checks: `npm test`, plus the `DSH_HOME` fixture boot below
  (`--dump-config | grep -A5 hover-info`, `--port 0` boot).

### Develop

```sh
npm install
npm test          # node --test: DOM-stub enhancer + host wiring, all fakes
```

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

### Deploy recipe (live web profile — WSL)

The live profile is a **pnpm tree on a Windows mount**, so deploy never runs a
package manager inside it:

1. Edit `~/.dsh/profiles/web/package.json`: add
   `"@comecaramelos/dsh-hover-information": "file:<repo path>"` to
   `dependencies` and the same specifier to the `dsh.profile.bundles` list,
   after `@deepseek-ai/dsh-base` / `@deepseek-ai/dsh-web-app`.
2. Symlink the repo into the tree:
   `ln -s <repo> ~/.dsh/profiles/web/node_modules/@comecaramelos/dsh-hover-information`.
3. Ask the user to restart/refresh the GUI — client bundles do not hot-update
   in the live profile, and the agent must not restart `dsh web`.

The browser client injects the live services it reads
(`@deepseek-ai/dsh-api-session-controller`,
`@deepseek-ai/dsh-client-connection`, `@deepseek-ai/dsh-client-locale`,
`@deepseek-ai/dsh-client-ui-settings`) — all already mounted by the base
profile, so deploy stays `file:` + bundle entry + symlink.

### Isolated boot check (no live profile involved)

```sh
rm -rf /tmp/dsh-hi-home
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
   steps, tokens in/out, compactions, context, subagents, model) and formats
   applied; toggling a metric in Settings → Plugins updates open cards <1 s.
6. `active: false` in the Settings card (or disabling the bundle row) →
   stock card everywhere.
7. A session with neither a live host entry nor cached `hoverInfo` projection
   values (or the endpoint absent) → stock card, at most one console debug
   line. A session that is only cached (the cold-start case) must still render
   its metrics block from the row's projection values.
8. Settings → Plugins card: collapsible, closed by default; 12 toggles +
   refresh interval; Overridden badge + reset per field; invalid refreshMs
   drafts never write.
9. Open a text file in the sidebar preview → header grows two tool buttons
   next to Open-with/wrap/reload (content copy + path copy, check marks
   1.3 s). Copy path → absolute path in clipboard, zero RPC. Copy content on
   a fully loaded file → exact source; on a Markdown preview the SOURCE is
   copied, not rendered text. A byte/PDF preview click copies nothing (one
   debug line only).
10. Close the preview tab / switch away → no leaked observers; the lazy
    heartbeat starts with the first preview/card and stops with the last.
    `active: false` → preview header stays stock.
