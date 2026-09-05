// Registration order is what assigns the positional typeIds and wireIds, so a client and a server
// that register in different orders mean different things by the same id. One rule fixes it: the mod
// directories, sorted by name. This holds the sim loadout to that order, and holds the two name
// transforms — the game's and the builder's, deliberately separate — to the same answers.

import {test} from "node:test";
import assert from "node:assert/strict";
import {simLoadout, MOD_DIRS} from "@/mods/loadout.js";
import {modName, modTitle} from "@/mods/modNames.js";
import {packageName, displayTitle} from "../../tools/build-mod.js";

test("simLoadout registers the mods in directory order", () => {
    const registered = simLoadout().map(pkg => pkg.declaration.constructor.name.replace(/Declaration$/, ""));
    const expected = MOD_DIRS.map(dir => modTitle(dir).replace(/ /g, ""));

    assert.deepEqual(registered, expected);
});

test("the mod name transform agrees with the builder's, which is deliberately separate", () => {
    // tools/build-mod.js builds anyone's mod, so it must not import this game's loadout. That
    // leaves two copies of one rule; this holds them together.
    for (const dir of MOD_DIRS) {
        assert.equal(modName(dir), packageName(`src/mods/${dir}`));
        assert.equal(modTitle(dir), displayTitle(`src/mods/${dir}`));
    }
});

test("an ordering prefix orders a mod in both transforms without naming it", () => {
    assert.equal(modName("99-my-mod"), packageName("dev-mods/99-my-mod"));
    assert.equal(modTitle("99-my-mod"), displayTitle("dev-mods/99-my-mod"));
});
