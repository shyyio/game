# pebble-generator

The example mod for [Shy's Power-Up Factory](https://spupgame.com): one machine that makes an
item, its art, and a small example of everything else a mod can do. Copy it to start your own.

A mod is named after its directory. From the game checkout:

```
cp -r dev-mods/pebble-generator dev-mods/my-mod
npm run dev                                          # game client + local play, my-mod loaded
npm run serve                                        # game server, my-mod loaded
npm test                                             # the game's specs and every dev-mod's
npm run build:mod -- dev-mods/my-mod out --version 1.0.0
npm run check:mod -- out                             # what the registry checks before publishing
```

`dev-mods/` is gitignored apart from this example, so `my-mod` is its own repository: `git init`
in it, or clone your repository there.

## Structure

```
declaration.js              what the mod adds: machines, items, wire classes. The only required file.
sim.js                      server code (optional)
client.js, client/          browser code (optional)
common/                     code both sides import
assets.js                   the mod's texture atlases
sprites/                    source art, one file per frame
sprites.png, sprites.json   the packed atlas (pixi.js / TexturePacker format)
*.spec.js                   specs, beside the module they test
```

Import the game as `@spup/sdk` (and `@spup/sdk/client` in browser code) and your own files by
path; nothing else may be imported. Specs may also reach the game's test harness through `@/test/`.

## Art

Draw at half the size the game shows and let the packer double it, the way the base game's art is
made:

| what    | you draw        | packed frame    |
|---------|-----------------|-----------------|
| item    | 16x16           | 32x32           |
| machine | 32x32 per tile  | 64x64 per tile  |

Pack `sprites/` with TexturePacker at scale 2, pixel-art (nearest) scaling, JSON (hash) format, into
`sprites.png` + `sprites.json`. The path inside `sprites/` is the frame name the code asks for:
`sprites/pebble-generator/pebble.png` is `"pebble-generator/pebble"`. Frame names are shared with
every other mod, so prefix yours with your mod's name.

An item fills its frame: trim the transparent margin. A machine does not: its frame is the tile it
stands on.

## Publishing

Push your mod to a public repository, then open a PR against
[shyyio/spup-mods](https://github.com/shyyio/spup-mods#listing-a-mod). The listing's `toolchain`
is the game version you built against: the registry checks the game out at that tag and builds your
pinned commit with it.
