import {test} from "node:test";
import assert from "node:assert/strict";
import {ModLockEntry, ModLockfile} from "@/common/ModLockfile.js";

const HASH = `sha256-${"ab".repeat(32)}`;

/**
 * @param {string} name
 * @param {string} version
 * @returns {ModLockEntry}
 */
function entry(name, version) {
    return new ModLockEntry(`file:///mods/${name}/`, name, version, new Map([["mod.json", HASH]]));
}

/**
 * @param {string} url
 * @returns {object} a pin entry as a config file holds it
 */
function pinned(url) {
    return {url, name: "logistics", version: "1.0.0", integrity: {"mod.json": HASH}};
}

test("a pin URL naming a bare path is refused: a package is fetched, never read as a path", () => {
    assert.throws(() => ModLockEntry.parse(pinned("build/mods/logistics/")), /scheme/);
});

test("a pin URL keeps every scheme a package is fetched over", () => {
    assert.equal(ModLockEntry.parse(pinned("file:///mods/logistics/")).url, "file:///mods/logistics/");
    assert.equal(ModLockEntry.parse(pinned("https://mods.example/logistics/")).url, "https://mods.example/logistics/");
});

test("withUpdated swaps in the built entry for every name it knows, in place", () => {
    const current = new ModLockfile([entry("base-game", "1.0.0"), entry("logistics", "2.1.0"), entry("fluids", "1.0.0")]);
    const built = new ModLockfile([entry("base-game", "1.1.0"), entry("fluids", "1.1.0")]);
    const updated = current.withUpdated(built);
    assert.deepEqual(updated.mods.map(mod => `${mod.name} ${mod.version}`), [
        "base-game 1.1.0",
        "logistics 2.1.0",
        "fluids 1.1.0",
    ]);
});

test("withUpdated appends a built mod the list does not pin yet, in built order", () => {
    const current = new ModLockfile([entry("base-game", "1.0.0"), entry("logistics", "2.1.0")]);
    const built = new ModLockfile([entry("base-game", "1.1.0"), entry("fluids", "1.1.0"), entry("market", "1.1.0")]);
    const updated = current.withUpdated(built);
    assert.deepEqual(updated.mods.map(mod => `${mod.name} ${mod.version}`), [
        "base-game 1.1.0",
        "logistics 2.1.0",
        "fluids 1.1.0",
        "market 1.1.0",
    ]);
});

test("withUpdated leaves the receiver untouched", () => {
    const current = new ModLockfile([entry("base-game", "1.0.0")]);
    current.withUpdated(new ModLockfile([entry("base-game", "1.1.0")]));
    assert.equal(current.mods[0].version, "1.0.0");
});
