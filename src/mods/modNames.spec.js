import test from "node:test";
import assert from "node:assert/strict";
import {modName, modTitle} from "@/mods/modNames.js";

test("a mod's name is its directory name", () => {
    assert.equal(modName("base-textures"), "base-textures");
    assert.equal(modName("notes"), "notes");
});

test("an ordering prefix places a mod without naming it", () => {
    assert.equal(modName("99-my-mod"), "my-mod");
    assert.equal(modTitle("99-my-mod"), "My Mod");
});

test("a mod's display title is its name in words", () => {
    assert.equal(modTitle("base-textures"), "Base Textures");
    assert.equal(modTitle("notes"), "Notes");
    assert.equal(modTitle("cursor-sync"), "Cursor Sync");
});
