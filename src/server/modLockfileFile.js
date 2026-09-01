// The operator's mods.json on disk. The lockfile model itself is @/common/ModLockfile.js, which the
// browser shares to pin its own local loadout.

import {existsSync, readFileSync, writeFileSync} from "node:fs";
import {ModLockfile} from "@/common/ModLockfile.js";

/**
 * @param {string} path
 * @returns {ModLockfile}
 */
export function readLockfile(path) {
    return ModLockfile.parse(JSON.parse(readFileSync(path, "utf8")));
}

/**
 * Reads the lockfile, treating a missing file as an empty one (the first `add` creates it).
 * @param {string} path
 * @returns {ModLockfile}
 */
export function readLockfileOrEmpty(path) {
    if (!existsSync(path)) {
        return new ModLockfile([]);
    }
    return readLockfile(path);
}

/**
 * @param {ModLockfile} lockfile
 * @param {string} path
 * @returns {void}
 */
export function writeLockfile(lockfile, path) {
    writeFileSync(path, `${JSON.stringify(lockfile.toJSON(), null, 4)}\n`);
}
