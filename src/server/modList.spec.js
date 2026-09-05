import test from "node:test";
import assert from "node:assert/strict";
import {SDK_VERSION} from "@/common/ModManifest.js";
import {builtInMod, externalMod, builtInModList, externalModList, modListJson} from "@/server/modList.js";

test("a built-in entry names a mod the client already has, and carries no code to fetch", () => {
    const list = JSON.parse(modListJson([builtInMod("logistics", "4.0.0")]));

    assert.equal(list.sdkVersion, SDK_VERSION);
    assert.deepEqual(list.mods, [{name: "logistics", version: "4.0.0"}]);
});

test("an external entry says where to download the mod and what it must hash to", () => {
    const list = JSON.parse(modListJson([
        externalMod("widgets", "1.2.0", ["declaration", "sim"], "https://mods.example.com/widgets/1.2.0/", "sha256-ab12"),
    ]));

    assert.deepEqual(list.mods, [{
        name: "widgets",
        version: "1.2.0",
        parts: ["declaration", "sim"],
        url: "https://mods.example.com/widgets/1.2.0/",
        integrity: "sha256-ab12",
    }]);
});

test("the list keeps loadout order, which is what assigns the positional ids", () => {
    const list = JSON.parse(modListJson([
        builtInMod("base-game", "4.0.0"),
        externalMod("widgets", "1.2.0", ["declaration"], "https://mods.example.com/widgets/1.2.0/", "sha256-ab12"),
    ]));

    assert.deepEqual(list.mods.map(mod => mod.name), ["base-game", "widgets"]);
});

test("built-in entries are the mods this build carries, at the game version", () => {
    const entries = builtInModList(["base-game", "logistics"], "4.0.0");

    assert.deepEqual(entries, [
        {name: "base-game", version: "4.0.0"},
        {name: "logistics", version: "4.0.0"},
    ]);
});

test("external entries carry each package's manifest and where its bundle came from", () => {
    const packaged = [{
        manifest: {name: "widgets", version: "1.2.0", parts: ["declaration"], entry: "mod.js"},
        entry: {url: "https://mods.example.com/widgets/1.2.0/", integrityOf: () => "sha256-ab12"},
    }];

    assert.deepEqual(externalModList(packaged), [{
        name: "widgets",
        version: "1.2.0",
        parts: ["declaration"],
        url: "https://mods.example.com/widgets/1.2.0/",
        integrity: "sha256-ab12",
    }]);
});
