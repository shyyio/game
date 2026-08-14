import {test} from "node:test";
import assert from "node:assert/strict";
import {ModManifest, MOD_PART_SIM, MOD_PART_CLIENT, SDK_VERSION} from "@/common/ModManifest.js";

function validJson(overrides = {}) {
    return {
        name: "market",
        version: "1.4.0",
        sdkVersion: SDK_VERSION,
        entry: "mod.js",
        parts: ["declaration", "sim", "client"],
        ...overrides,
    };
}

test("a well-formed manifest parses into its fields", () => {
    const manifest = ModManifest.parse(validJson({homepage: "https://mods.spupgame.com/market/"}));

    assert.equal(manifest.name, "market");
    assert.equal(manifest.version, "1.4.0");
    assert.equal(manifest.entry, "mod.js");
    assert.ok(manifest.has(MOD_PART_SIM));
    assert.ok(manifest.has(MOD_PART_CLIENT));
    assert.equal(manifest.homepage, "https://mods.spupgame.com/market/");
    // A mod's art is inlined in its bundle, so a package is the manifest plus one file.
    assert.deepEqual(manifest.files, ["mod.js"]);
});

test("a declaration-only manifest needs no optional parts", () => {
    const manifest = ModManifest.parse(validJson({parts: ["declaration"]}));

    assert.equal(manifest.has(MOD_PART_SIM), false);
    assert.equal(manifest.homepage, null);
    assert.deepEqual(manifest.files, ["mod.js"]);
});

test("a parsed manifest round-trips through toJSON", () => {
    const json = validJson();
    assert.deepEqual(ModManifest.parse(json).toJSON(), json);
});

test("malformed manifests are rejected loudly", () => {
    const cases = {
        "unknown key": {extra: 1},
        "bad name": {name: "Market"},
        "bad version": {version: "1.4"},
        "bad sdkVersion": {sdkVersion: "1"},
        "bad entry": {entry: "../mod.js"},
        "non-js entry": {entry: "mod.wasm"},
        "missing declaration part": {parts: ["sim"]},
        "unknown part": {parts: ["declaration", "worker"]},
        "duplicate part": {parts: ["declaration", "sim", "sim"]},
        "asset file listed": {textures: [{image: "sprites.png", json: "sprites.json"}]},
        "non-https homepage": {homepage: "http://example.com"},
    };
    for (const [what, overrides] of Object.entries(cases)) {
        assert.throws(() => ModManifest.parse(validJson(overrides)), what);
    }
});
