import {test} from "node:test";
import assert from "node:assert/strict";
import {addRelease} from "../../tools/add-release.js";

const OLD_COMMIT = "a".repeat(40);
const NEW_COMMIT = "b".repeat(40);

function listing() {
    return {
        name: "pebble-generator",
        repo: "https://github.com/shyyio/game",
        path: "dev-mods/pebble-generator",
        description: "The example mod.",
        versions: [{version: "2.0.0", commit: OLD_COMMIT, toolchain: "2.0.0", sdkVersion: 2}],
    };
}

test("a release appends an entry the game builds at that version", () => {
    const listed = listing();

    addRelease(listed, "4.1.0", NEW_COMMIT);

    assert.deepEqual(listed.versions[1], {
        version: "4.1.0",
        commit: NEW_COMMIT,
        toolchain: "4.1.0",
        sdkVersion: 4,
    });
});

test("a release no newer than the last entry is refused", () => {
    const listed = listing();

    assert.throws(() => addRelease(listed, "2.0.0", NEW_COMMIT), /2\.0\.0/);
    assert.throws(() => addRelease(listed, "1.5.0", NEW_COMMIT), /1\.5\.0/);
    assert.equal(listed.versions.length, 1);
});
