import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, mkdirSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {Symbolicator} from "@/reportingserver/Symbolicator.js";

const BUILD_VERSION = "abc123";

// One mapping: generated line 1, column 0 -> thing.js line 1, column 0.
const MAP = JSON.stringify({
    version: 3,
    file: "app.js",
    sources: ["../src/thing.js"],
    names: [],
    mappings: "AAAA",
});

/**
 * @returns {string} a maps dir holding app.js.map for BUILD_VERSION
 */
function buildMapsDir() {
    const mapsDir = mkdtempSync(path.join(tmpdir(), "spup-maps-"));
    const assets = path.join(mapsDir, BUILD_VERSION, "build", "client", "assets");
    mkdirSync(assets, {recursive: true});
    writeFileSync(path.join(assets, "app.js.map"), MAP);
    return mapsDir;
}

test("resolve returns null when the build's maps match no frame", async () => {
    const symbolicator = new Symbolicator(buildMapsDir());
    const stack = "TypeError: nope\n    at p (https://example.com/assets/other.js:1:1)";
    assert.equal(await symbolicator.resolve(BUILD_VERSION, stack), null);
});
