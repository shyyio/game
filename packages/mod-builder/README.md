# @spup/mod-builder

Builds and checks a mod for [Shy's Power-Up Factory](https://spupgame.com).

## Commands

Run them in your mod: the mod is the working directory, it builds into `./dist`, and the version is
the one in your `package.json`. Every default can be overridden — `build <mod dir> <out dir>`,
`check <package dir>`, `--version <x.y.z>`.

- **`build`** — writes `dist/mod.js` and `dist/mod.json`. Optional
  `--homepage <url>` goes into the manifest. The bundle is minified (class names kept — the wire
  codec names each message and event type after its class); `--minify false` keeps it readable,
  which is what the dev server builds with. The minifier is pinned to an exact version here, so the
  same source hashes the same from any machine.
- **`check`** — what a registry listing must pass: the manifest parses, the bundle
  reaches no global outside a small pure-computation whitelist (`fetch`, `document`, `eval` and
  friends fail here), the declared parts match the exported factories, and the declaration and sim
  factories evaluate against a stub SDK.
- **`scan`** — just the free-variable scan, for a quick look at a bundle.

`check` proves a package loads and behaves at its edges; it cannot prove the content is valid, since
that needs a running engine. The registry runs it on every published version, and a maintainer reads
the source besides.