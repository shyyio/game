// Turns a chosen local loadout into ModPackages, in its order — which is what assigns the positional
// typeIds after the base loadout's.

import {ModFileStore, loadModPackage} from "@/client/ModPackageLoader.js";

/**
 * Loads a local loadout's mods with their sim parts — local play hosts the sim in this page.
 * @param {LocalLoadout} loadout
 * @returns {Promise<ModPackage[]>}
 */
export async function loadLocalMods(loadout) {
    if (loadout.mods.length === 0) {
        return [];
    }
    const store = await ModFileStore.open();
    const packages = [];
    for (const mod of loadout.mods) {
        packages.push(await loadModPackage(store, mod.lockEntry, true));
    }
    return packages;
}
