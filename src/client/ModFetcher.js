// Fetches a server's loadout before joining it: the mod index, then one bundle per mod, verified
// against the content hash it is served under and evaluated through the factory interface. A mod's
// art is inlined in its bundle, so there is nothing else to fetch.
//
// The client ships no game content of its own in remote mode — the server's pin list is the
// loadout, which is also what keeps the positional wire ids in sync.

import {SDK_VERSION} from "@/common/ModManifest.js";
import {contentNameHex} from "@/common/ModIntegrity.js";
import {httpOriginFor} from "@/common/util.js";
import {ModFileStore, fetchPinnedFile, importBundle, instantiatePackage} from "@/client/ModPackageLoader.js";

/**
 * The mods a server runs, as ModPackages in the server's order.
 * @param {string} serverUrl the websocket URL being joined
 * @returns {Promise<ModPackage[]>}
 */
export async function fetchModLoadout(serverUrl) {
    const origin = httpOriginFor(serverUrl);
    const response = await fetch(`${origin}/mods/index.json`);
    if (!response.ok) {
        throw new Error(
            `This server does not serve its mod list (${response.status}); it needs a build that runs a pinned loadout`,
        );
    }
    const index = await response.json();
    if (index.sdkVersion > SDK_VERSION) {
        throw new Error("This server runs mods built for a newer game; update your client to join it");
    }
    if (index.sdkVersion !== SDK_VERSION) {
        throw new Error(`This server runs mods built for game SDK ${index.sdkVersion}; this client speaks ${SDK_VERSION}`);
    }

    // A served file's name is its hash, so the index carries no separate integrity map.
    const store = await ModFileStore.open();
    // Downloaded together — a first join is one round trip per mod otherwise — but evaluated in the
    // server's order, which is what assigns the positional ids.
    const sources = await Promise.all(index.mods.map(mod => fetchPinnedFile(
        store, `${origin}/mods/${mod.entry}`, mod.entry, contentNameHex(mod.entry),
    )));
    const packages = [];
    for (const [position, mod] of index.mods.entries()) {
        // Remote mode never hosts a sim, so a mod's sim part stays unevaluated here.
        packages.push(instantiatePackage(await importBundle(sources[position]), mod.parts, false));
    }
    return packages;
}
