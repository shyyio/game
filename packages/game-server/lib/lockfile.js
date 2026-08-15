// Writes the `mods.json` a dev server boots from: the base mods shipped in this package, then the
// mod being worked on, each pinned by content hash exactly as an operator's lockfile pins a
// published package. Order is loadout order — it assigns the positional type and wire ids.

import {createHash} from "node:crypto";
import {readdirSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {pathToFileURL} from "node:url";

const MANIFEST_FILE = "mod.json";

/**
 * @param {string} path
 * @returns {string} "sha256-<hex>", the form a lockfile pins
 */
function fileIntegrity(path) {
    return `sha256-${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

/**
 * One lockfile entry for a built package directory.
 * @param {string} dir
 * @returns {object}
 */
function pin(dir) {
    const manifest = JSON.parse(readFileSync(join(dir, MANIFEST_FILE), "utf8"));
    const integrity = {[MANIFEST_FILE]: fileIntegrity(join(dir, MANIFEST_FILE))};
    integrity[manifest.entry] = fileIntegrity(join(dir, manifest.entry));
    return {
        url: `${pathToFileURL(dir).href}/`,
        name: manifest.name,
        version: manifest.version,
        integrity,
    };
}

/**
 * The base-mod package directories this package ships, in loadout order.
 * @param {string} modsDir
 * @returns {string[]}
 */
export function baseModDirs(modsDir) {
    const order = JSON.parse(readFileSync(join(modsDir, "order.json"), "utf8"));
    const present = readdirSync(modsDir, {withFileTypes: true})
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);
    const missing = order.filter(name => !present.includes(name));
    if (missing.length > 0) {
        throw new Error(`${modsDir} is missing base mods: ${missing.join(", ")}`);
    }
    return order.map(name => join(modsDir, name));
}

/**
 * Writes a lockfile pinning the base mods followed by `modPackageDir`.
 * @param {string} path where mods.json goes
 * @param {string} modsDir the package's base-mod directory
 * @param {string} modPackageDir the built mod being worked on
 * @returns {void}
 */
export function writeDevLockfile(path, modsDir, modPackageDir) {
    const mods = [...baseModDirs(modsDir).map(pin), pin(modPackageDir)];
    writeFileSync(path, `${JSON.stringify({mods}, null, 4)}\n`);
}
