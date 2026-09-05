// The browser's loadout: what modSources.js already found, plus each mod's client part.
//
// Browser-only, and imported lazily: the client parts pull pixi in, which a remote join and the
// server bundle must not carry.

import {MOD_ROOTS} from "@/mods/modDirs.js";
import {MOD_SOURCES} from "@/mods/modSources.js";
import {clientPackagesFrom} from "@/mods/modPackages.js";

const CLIENTS = Object.assign(
    {},
    import.meta.glob("/src/mods/*/client.js", {eager: true}),
    import.meta.env.DEV ? import.meta.glob("/dev-mods/*/client.js", {eager: true}) : {},
);

/**
 * @param {string} dir
 * @returns {object|null} the mod's client part, or null when it has none
 */
function clientOf(dir) {
    const module = CLIENTS[`/${MOD_ROOTS.get(dir)}/${dir}/client.js`];
    if (module === undefined) {
        return null;
    }
    return module;
}

/**
 * The loadout for a browser client, which also runs the local sim: declarations, sim parts and
 * client parts, in the order modSources.js hands them out.
 * @returns {ModPackage[]}
 */
export function clientLoadout() {
    return clientPackagesFrom(MOD_SOURCES.map(source => ({
        dir: source.dir,
        declaration: source.declaration,
        sim: source.sim,
        client: clientOf(source.dir),
    })));
}
