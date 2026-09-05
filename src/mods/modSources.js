// The modules behind MOD_DIRS: each mod's declaration, and its sim part when it has one. Client
// parts are not here — importing them would drag pixi into the server bundle (see clientLoadout.js).
//
// This is the raw-node half: tests and a server run from a checkout, where the mods are files. Every
// vite build aliases this module to modSources.vite.js.

import {join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {MOD_DIRS, MOD_ROOTS, DECLARATION_FILE, SIM_FILE, modHasFile} from "@/mods/modDirs.js";

/**
 * @param {string} dir
 * @param {string} file
 * @returns {Promise<object|null>} the module, or null when the mod does not have that part
 */
async function partOf(dir, file) {
    const root = MOD_ROOTS.get(dir);
    if (!modHasFile(root, dir, file)) {
        return null;
    }
    return await import(pathToFileURL(resolve(join(root, dir, file))).href);
}

export const MOD_SOURCES = await Promise.all(MOD_DIRS.map(async dir => ({
    dir,
    declaration: await partOf(dir, DECLARATION_FILE),
    sim: await partOf(dir, SIM_FILE),
})));
