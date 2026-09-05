// The mod list a joining client reads: what this server runs, in loadout order, and where each mod
// comes from. The server serves the list, never the code — a mod's bundle is downloaded from the
// registry that published it, so a game host carries no distribution traffic.
//
// A built-in entry names a mod compiled into the client's own build, which is the code it runs for
// that entry; nothing is downloaded and nothing needs vouching for. An external entry names a mod
// this server's config holds, with the URL it came from and the hash its bundle must have.

import {SDK_VERSION} from "@/common/ModManifest.js";

/**
 * @param {string} name
 * @param {string} version
 * @returns {object} a list entry
 */
export function builtInMod(name, version) {
    return {name, version};
}

/**
 * @param {string} name
 * @param {string} version
 * @param {string[]} parts which factories the bundle exports
 * @param {string} url the package's base URL
 * @param {string} integrity the bundle's hash, as "sha256-..."
 * @returns {object} a list entry
 */
export function externalMod(name, version, parts, url, integrity) {
    return {name, version, parts, url, integrity};
}

/**
 * @param {string[]} dirs the mod directories this build carries, in loadout order
 * @param {string} version the game version, which is what its mods are versioned at
 * @returns {object[]} list entries
 */
export function builtInModList(dirs, version) {
    return dirs.map(dir => builtInMod(dir, version));
}

/**
 * @param {PackagedMod[]} mods in loadout order
 * @returns {object[]} list entries
 */
export function externalModList(mods) {
    return mods.map(mod => externalMod(
        mod.manifest.name,
        mod.manifest.version,
        mod.manifest.parts,
        mod.entry.url,
        mod.entry.integrityOf(mod.manifest.entry),
    ));
}

/**
 * @param {object[]} mods in loadout order
 * @returns {string} what a client consumes
 */
export function modListJson(mods) {
    return JSON.stringify({sdkVersion: SDK_VERSION, mods});
}
