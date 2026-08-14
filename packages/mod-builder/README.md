# @spup/mod-builder

Builds and checks a mod for [Shy's Power-Up Factory](https://spupgame.com).

A mod is a directory of ordinary ES modules that import the game's SDK. This turns it into a
package: one `mod.js` bundle with no imports at all (its art inlined), plus the `mod.json` manifest
that describes it. That package is what a game server installs and what the
[registry](https://github.com/shyyio/spup-mods) publishes.

```
npx @spup/mod-builder build ./my-mod ./dist --version 1.0.0
npx @spup/mod-builder check ./dist
```

## Writing a mod

Your mod's entry files sit at its root, and everything else mirrors them:

```
declaration.js   required — object types, items, wire classes (pure data)
common/          modules both sides use
sim.js, sim/     optional — server-side behavior
client.js, client/   optional — rendering and input
sprites.png, sprites.json   optional atlases, inlined into the bundle
```

Each entry file exports exactly one class. Import the SDK as `@/sdk/common.js` (and
`@/sdk/client.js` from client-side files); import your own files relatively. Those two specifiers
are the only non-relative imports a mod may use — the builder rejects anything else, because the
package has to load with no module resolution at all.

## Commands

- **`build <mod dir> <out dir> --version <x.y.z>`** — writes `mod.js` and `mod.json`. Optional
  `--homepage <url>` goes into the manifest.
- **`check <package dir>`** — what a registry listing must pass: the manifest parses, the bundle
  reaches no global outside a small pure-computation whitelist (`fetch`, `document`, `eval` and
  friends fail here), the declared parts match the exported factories, and the declaration and sim
  factories evaluate against a stub SDK.
- **`scan <mod.js>`** — just the free-variable scan, for a quick look at a bundle.

`check` proves a package loads and behaves at its edges; it cannot prove the content is valid, since
that needs a running engine. The registry runs it on every published version, and a maintainer reads
the source besides.

## Versioning

The package version tracks the SDK it targets: a mod built with `@spup/mod-builder@1.x` declares
`sdkVersion` 1 and loads in any client and server speaking that SDK. A server refuses a mod whose
`sdkVersion` it does not know, so bumping the major here means rebuilding mods against it.
