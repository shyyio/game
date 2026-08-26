// Turns a chosen local loadout into ModPackages, in its order — which is what assigns the positional
// typeIds after the base loadout's.

import {DEV_TOOLS} from "@/common/env.js";
import {LOCAL_MOD_SOURCE_URL} from "@/client/LocalLoadout.js";
import {ModFileStore, loadPinnedPackage, loadUnpinnedPackage} from "@/client/ModPackageLoader.js";

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
        if (mod.source === LOCAL_MOD_SOURCE_URL) {
            // sideloadedModUrls() and LocalMod.fromUrl already refuse without the dev tools; this is
            // the last gate before the code actually runs.
            if (!DEV_TOOLS) {
                throw new Error(`Mod "${mod.name}" is served off a URL, which needs a build with the dev tools on`);
            }
            packages.push(await loadUnpinnedPackage(mod.url, true));
            continue;
        }
        packages.push(await loadPinnedPackage(store, mod.lockEntry, true));
    }
    return packages;
}
