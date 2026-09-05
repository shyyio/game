import test from "node:test";
import assert from "node:assert/strict";
import {MOD_DIRS} from "@/mods/modDirs.js";
import {MOD_SOURCES} from "@/mods/modSources.js";

test("a source carries its directory and the modules that directory holds", () => {
    const logistics = MOD_SOURCES.find(source => source.dir === "logistics");

    assert.equal(typeof logistics.declaration.LogisticsDeclaration, "function");
    assert.equal(typeof logistics.sim.LogisticsSimMod, "function");
});

test("a mod without a sim part carries none", () => {
    const baseGame = MOD_SOURCES.find(source => source.dir === "base-game");

    assert.equal(baseGame.sim, null);
});

test("MOD_SOURCES is in MOD_DIRS order, which is what assigns the positional ids", () => {
    assert.deepEqual(MOD_SOURCES.map(source => source.dir), MOD_DIRS);
});
