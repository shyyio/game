# @spup/mod-builder

Builds and checks a mod for [Shy's Power-Up Factory](https://spupgame.com).

## Commands

Run them in your mod: the mod is the working directory, it builds into `./dist`, and the version is
the one in your `package.json`. Every default can be overridden — `build <mod dir> <out dir>`,
`check <package dir>`, `--version <x.y.z>`.

- **`build`** — writes `dist/mod.js` and `dist/mod.json`. Optional `--title <name>` (the display
  name players see; it defaults to your directory name in words) and `--homepage <url>` go into the
  manifest. The bundle is minified (class names kept — the wire
  codec names each message and event type after its class); `--minify false` keeps it readable,
  which is what the dev server builds with. The minifier is pinned to an exact version here, so the
  same source hashes the same from any machine.
- **`check`** — what a registry listing must pass: the manifest parses, the bundle
  reaches no global outside a small pure-computation whitelist (`fetch`, `document`, `eval`,
  `import()` and friends fail here), the declared parts match the exported factories, and the
  declaration and sim factories evaluate against a stub SDK.
- **`scan`** — just the free-variable scan, for a quick look at a bundle.

A bundle that fails the scan is never run. One that passes is still only *run* under node's
permission model, in a process that may read the package and do nothing else — the scan is a lint,
not a sandbox, and `[].constructor.constructor` is the `Function` constructor under a name no scan
can see.

`check` proves a package loads and behaves at its edges; it cannot prove the content is valid, since
that needs a running engine. The registry runs it on every published version, and a maintainer reads
the source besides.