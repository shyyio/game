// Runs a mod's tests against the real engine, outside any game checkout:
//
//   node --import @spup/game-server/test-loader --test *.spec.js
//
// It resolves `@spup/sdk` to the bundled engine (dist-harness/harness.js), so a spec can build a
// Game with `makeGame`, place the mod's objects, tick, and assert on what happened. Import the
// helpers from "@spup/game-server/test".

import {register} from "node:module";

register("./testHooks.js", import.meta.url);
