// The three places that fix the loadout order have to agree: BASE_MOD_DIRS, simLoadout, and
// clientLoadout. Registration order is what assigns the positional typeIds and wireIds, so drift
// between them silently makes a client and a server mean different things by the same id.
//
// clientLoadout is read as source rather than imported: its client parts pull in pixi, which does
// not run headless.

import {test} from "node:test";
import assert from "node:assert/strict";
import {readdirSync, readFileSync} from "node:fs";
import {BASE_MOD_DIRS, simLoadout} from "@/mods/loadout.js";
import {baseModName, baseModTitle} from "@/mods/baseMods.js";
import {packageName} from "../../tools/build-mod.js";

const DECLARATION_PATTERN = /new (\w+)Declaration\(\)/g;

/**
 * The declaration classes a loadout file constructs, in the order it constructs them.
 * @param {string} path
 * @returns {string[]}
 */
function declarationsIn(path) {
    const source = readFileSync(path, "utf8");
    const body = source.slice(source.indexOf("return ["));
    return [...body.matchAll(DECLARATION_PATTERN)].map(match => match[1]);
}

test("BASE_MOD_DIRS lists every mod directory, and nothing else", () => {
    const dirs = readdirSync("src/mods", {withFileTypes: true})
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);

    assert.deepEqual([...BASE_MOD_DIRS].sort(), dirs.sort());
});

test("BASE_MOD_DIRS is in simLoadout's order", () => {
    const registered = simLoadout().map(pkg => pkg.declaration.constructor.name.replace(/Declaration$/, ""));

    assert.deepEqual(registered, BASE_MOD_DIRS);
});

test("clientLoadout registers the same declarations in the same order as simLoadout", () => {
    assert.deepEqual(
        declarationsIn("src/mods/clientLoadout.js"),
        declarationsIn("src/mods/loadout.js"),
    );
});

test("the base mod name transform agrees with the builder's, which is deliberately separate", () => {
    // tools/build-mod.js ships standalone as @spup/mod-builder and builds anyone's mod, so it must
    // not import this game's loadout. That leaves two copies of one rule; this holds them together.
    for (const dir of BASE_MOD_DIRS) {
        assert.equal(baseModName(dir), packageName(`src/mods/${dir}`));
    }
});

test("a base mod's display title is its directory name in words", () => {
    assert.equal(baseModTitle("BaseTextures"), "Base Textures");
    assert.equal(baseModTitle("Notes"), "Notes");
    assert.equal(baseModTitle("CursorSync"), "Cursor Sync");
});
