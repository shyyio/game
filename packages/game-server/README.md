# @spup/game-server

The [Shy's Power-Up Factory](https://spupgame.com) server, the base mods, and the test harness a mod's specs run against.

```
npm i -D @spup/game-server
npx spup-dev server
```

## Joining it

Log into the client, then use the server list's **Connect to a URL** field (`ws://localhost:27500`). 

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