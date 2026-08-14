// Lets a mod's own tests run with plain `node --test`, outside any game checkout:
//
//   node --import @spup/mod-builder/test-loader --test *.spec.js
//
// It resolves the two SDK specifiers to a fake (sdkFake.js) and gives asset imports the same
// meaning the builder does — a .png import is its path, a .json import is its parsed contents.

import {register} from "node:module";

register("./testHooks.js", import.meta.url);
