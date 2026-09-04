# @spup/game-server

The [Shy's Power-Up Factory](https://spupgame.com) server, the base mods, and the test harness a mod's specs run against.

The `spup-dev` command lives in `@spup/game-client`; this package is what its `server` verb needs.

```
npm i -D @spup/game-client @spup/game-server
npx spup-dev server
```

## Joining it

Log into the client, then use the server list's **Connect to a URL** field (`ws://localhost:27500`). 

## Admin page

A running server serves its admin page at `/admin` on its own port (`http://localhost:27500/admin`
for the default). It asks once for the admin token, which the server prints at boot and keeps as
`adminToken` in its config file (`--config`, default `server.json`). Everything the server runs on
is in that one file, the mods included: pick them from the registry by checkbox, or paste a saved
settings block. A relative path in it counts from the file's own directory, so that directory holds
the whole server. Everything applies at once; a mod change rebuilds the world and reloads every
connected client. Only the listen address and port need a restart. Removing a mod converts the saved
world: the page lists the objects and items that would be lost and asks first. A saved world keeps
its seed; "Reset world" on the page deletes it and starts fresh with whatever seed is set.

After upgrading this package, re-pin the base mods it ships before starting the server:

```
node node_modules/@spup/game-server/dist/modsCli.js sync-base --dist-mods node_modules/@spup/game-server/dist-mods --config server.json
```

## Testing against the engine

```
node --import @spup/game-server/test-loader --test test/*.spec.js
```

```js
import {makeGameEngine, makeGame, ModPackage, CreateObjectMessage, Direction} from "@spup/game-server/test";

const engine = await makeGameEngine([new ModPackage(new MyDeclaration(), {sim: new MySimMod()})]);
engine.applyMessage(new CreateObjectMessage(MyType.typeId, 5, 5, Direction.UP));
engine.tickAll();
```