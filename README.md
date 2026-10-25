# @comecaramelos/dsh-hover-information

Aditional info in web UI.

**Preview card**

Configurable metrics block, configured on this bundle's own configuration page
on the Plugins page (turning the bundle row off is what disables the whole
enhancement):

![Preview card panel](assets/preview_panel.png)

- **Copy session ID** / **Copy workspace path** icons on the card's header
  row — `⧉ copy ID` / `⧉ copy path` beside the status dot and the relative
  time, instead of the stock whole-card copy button.
- **Metrics block**: turns, steps, tokens sent/received, cache tokens,
  compactions, purges (tool-result prunes), context window, subagents, model,
  tool calls, active time and created date — toggled per metric.

**Model selector**

- **Provider in the selector**: tooltip and visible value read
  `Provider > Model`.

## Install

From npm:

```sh
dsh plugin --profile web add @comecaramelos/dsh-hover-information
```

Manual install — the live profile installs the **published** package, so it is
just a manifest entry (materialized by `pnpm install` inside the profile; no
`link:`, no symlink there):

```json
{
  "dependencies": {
    "@comecaramelos/dsh-hover-information": "link:/path/to/dsh-hover-information"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@comecaramelos/dsh-hover-information"
      ]
    }
  }
}
```

Then restart the `web` host — browser bundles don't hot-update, and
the live `dsh web` gateway is never restarted by tooling.

## Develop

The row card is built on the shared base layer
[`@comecaramelos/dsh-ancesters`](https://github.com/ComeCaramelos/dsh-ancesters),
linked as a sibling checkout (`file:../dsh-ancesters`) — build it first.

```sh
npm install
npm run build      # tsc (host) + tsc typecheck + esbuild (browser) → lib/
npm test           # builds first, then node --test
```

Sources live in `src/host/**` (host half) and `src/client/**` (browser half);
`src/index.ts` is the host's re-export-only face, and `scripts/build-client.mjs`
collapses the browser half into one `lib/client.js` lazy-CJS bundle. `lib/` is
build output and is git-ignored. Every consumer —
the profile row, the browser bundle and the tests — resolves it through
`package.json#exports`, so run the build after editing sources and before
pointing a profile checkout at this tree. See [`AGENTS.md`](AGENTS.md) 
for the layout and the verification recipe.

---

[`CONTRIBUTING`](CONTRIBUTING.md) | [`LICENSE`](LICENSE.md)
