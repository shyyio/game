// One version line: the root package.json holds the game version, its major is the SDK version, and
// the packages staged out of this repo ship as it. The pack scripts write those; this catches a
// package whose manifest was edited by hand instead.

import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join, resolve, dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {GAME_VERSION} from "@/common/constants.js";
import {SDK_VERSION} from "@/common/ModManifest.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * @param {string} name a directory under packages/
 * @returns {object}
 */
function packageJson(name) {
    return JSON.parse(readFileSync(join(ROOT, "packages", name, "package.json"), "utf8"));
}

test("the SDK version is the game's major", () => {
    assert.equal(SDK_VERSION, Number(GAME_VERSION.split(".")[0]));
});

test("the packages built from this repo ship as the game version", () => {
    for (const name of ["sdk", "game-client", "game-server"]) {
        assert.equal(packageJson(name).version, GAME_VERSION, name);
    }
});

test("the toolchain has its own line, majoring on the SDK", () => {
    const major = Number(packageJson("mod-builder").version.split(".")[0]);
    assert.equal(major, SDK_VERSION);
});

test("the runtime packages depend on a toolchain speaking this SDK", () => {
    const builder = packageJson("game-client").dependencies["@spup/mod-builder"];
    assert.equal(builder, `^${packageJson("mod-builder").version}`);
});

// syncPackageVersion writes each package's own version, not the ranges between them: a major bump
// has to widen this one by hand, and the release stops here until it does.
test("the client asks for a server of this game version", () => {
    const server = packageJson("game-client").peerDependencies["@spup/game-server"];
    assert.equal(
        server,
        `^${GAME_VERSION}`,
        `packages/game-client/package.json peerDependencies["@spup/game-server"] is ${server}; `
        + `set it to ^${GAME_VERSION} by hand and commit (no pack script writes this range)`,
    );
});
