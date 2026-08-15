# @spup/game-client

The [Shy's Power-Up Factory](https://spupgame.com) web client.

```
npx @spup/game-client client
```

## Commands

Both commands build the mod in the working directory; `--mod <dir>` points them somewhere else.

**`spup-dev client`** — builds your mod, serves the client next to it, and opens it with `?mod=`.

- `--port <n>` - default 8080.
- `--host <address>` - default 127.0.0.1.
- `--out <dir>` - where the built package goes; a temporary directory by default.

**`spup-dev server`** — runs a real game server with the base mods and yours pinned, for
persistence, chunk claims and several players. Needs `@spup/game-server`. Join it from the client's
"Connect to a URL" field.

- `--port <n>` - default 27500.
- `--host <address>` - default 0.0.0.0.
- `--work <dir>` - lockfile, mod cache and world database; `.spup-dev` beside the mod by default.
  Delete it to start the world over.
- `--origin <url>` - what a join token is minted for: the URL a player types, not the interface the
  server listens on. Default `ws://localhost:<port>`.
- `--auth-server <url>` - default https://auth.spupgame.com.
- `--out <dir>` - where the built package goes; a temporary directory by default.