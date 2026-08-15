// The game version is the one version line: the root package.json holds it, its major is
// SDK_VERSION, and the packages built out of this repo ship as it. Each pack script writes it into
// the package it stages, so releasing is a single edit here.

import {readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {GAME_VERSION} from "../src/common/constants.js";

/**
 * Writes GAME_VERSION into a package's manifest.
 * @param {string} packageDir
 * @returns {boolean} whether it had to change
 */
export function syncPackageVersion(packageDir) {
    const path = join(packageDir, "package.json");
    const source = readFileSync(path, "utf8");
    const manifest = JSON.parse(source);
    if (manifest.version === GAME_VERSION) {
        return false;
    }
    manifest.version = GAME_VERSION;
    writeFileSync(path, `${JSON.stringify(manifest, null, 4)}\n`);
    return true;
}
