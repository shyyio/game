// The operator's mods.json on disk. The lockfile model itself is @/common/ModLockfile.js, which the
// browser shares to pin its own local loadout.

import {readFileSync, writeFileSync} from "node:fs";
import {ModLockfile} from "@/common/ModLockfile.js";

/**
 * @param {string} path
 * @returns {ModLockfile}
 */
export function readLockfile(path) {
    return ModLockfile.parse(JSON.parse(readFileSync(path, "utf8")));
}

/**
 * @param {ModLockfile} lockfile
 * @param {string} path
 * @returns {void}
 */
export function writeLockfile(lockfile, path) {
    writeFileSync(path, `${JSON.stringify(lockfile.toJSON(), null, 4)}\n`);
}
