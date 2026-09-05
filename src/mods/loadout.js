import {MOD_DIRS} from "@/mods/modDirs.js";
import {MOD_SOURCES} from "@/mods/modSources.js";
import {simPackagesFrom} from "@/mods/modPackages.js";

export {MOD_DIRS};

// The canonical mod loadout. Both build sites register the same declarations in the same order, so
// the positional typeIds/wireIds assigned at freeze() match between sim and client. The client
// loadout lives in clientLoadout.js — importing the client mods here would drag pixi into the
// server bundle.

/**
 * The loadout for a headless simulation (server, tests): declarations + sim parts only.
 * @returns {ModPackage[]}
 */
export function simLoadout() {
    return simPackagesFrom(MOD_SOURCES);
}
