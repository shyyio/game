// The mods a server runs, read off the list it serves before joining it.
//
// An entry is one of two kinds. A built-in one names a mod this client was compiled with, and the
// client uses its own copy: nothing is downloaded, and the server's word about it is only a claim
// about which loadout it runs. An external one names a mod the server's config holds, which is
// downloaded from the registry that published it, verified against the hash the server recorded,
// and evaluated from a blob.
//
// Either way the list's order is the loadout's order, which is what keeps the positional wire ids in
// sync between this client and that server.

import {SDK_VERSION} from "@/common/ModManifest.js";
import {integrityHex, contentName} from "@/common/ModIntegrity.js";
import {httpOriginFor} from "@/common/util.js";
import {MOD_DIRS} from "@/mods/modDirs.js";
import {modName} from "@/mods/modNames.js";
import {GAME_VERSION} from "@/common/constants.js";
import {ModFileStore, fetchVerifiedFile, importBundle, instantiatePackage} from "@/client/ModPackageLoader.js";
import {assertModsVerified} from "@/client/ModVerification.js";

const ENTRY_FILE = "mod.js";

/**
 * @param {object} mod a list entry
 * @returns {boolean} whether the client supplies this mod's code itself
 */
export function isBuiltIn(mod) {
    return mod.url === undefined;
}

/**
 * The package a built-in entry names, from what this client was compiled with.
 * @param {object} mod a built-in list entry
 * @param {Map<string, ModPackage>} byName this build's packages
 * @returns {ModPackage}
 */
export function builtInPackage(mod, byName) {
    const pkg = byName.get(mod.name);
    if (pkg === undefined) {
        throw new Error(`This server runs "${mod.name}", which your game does not have`);
    }
    if (mod.version !== GAME_VERSION) {
        throw new Error(`This server runs ${mod.name} ${mod.version}; your game has ${GAME_VERSION}`);
    }
    return pkg;
}

/**
 * @param {object} list the served mod list
 * @returns {void}
 */
function assertSdkVersion(list) {
    if (list.sdkVersion > SDK_VERSION) {
        throw new Error("This server runs mods built for a newer game; update your client to join it");
    }
    if (list.sdkVersion !== SDK_VERSION) {
        throw new Error(`Incompatible game server, expected SDK ${SDK_VERSION}, got ${list.sdkVersion}`);
    }
}

/**
 * The mods a server runs, as ModPackages in the server's order.
 * @param {string} serverUrl the websocket URL being joined
 * @returns {Promise<ModPackage[]>}
 */
export async function fetchModLoadout(serverUrl) {
    const origin = httpOriginFor(serverUrl);
    const response = await fetch(`${origin}/mods/index.json`);
    if (!response.ok) {
        throw new Error(`This server does not serve its mod list (${response.status})`);
    }
    const list = await response.json();
    assertSdkVersion(list);
    await assertModsVerified(list.mods.filter(mod => !isBuiltIn(mod)));

    const {clientLoadout} = await import("@/mods/clientLoadout.js");
    const byName = new Map(clientLoadout().map((pkg, position) => [modName(MOD_DIRS[position]), pkg]));
    const store = await ModFileStore.open();
    // Downloaded together — a first join is one round trip per mod otherwise — but evaluated in the
    // server's order, which is what assigns the positional ids.
    const sources = await Promise.all(list.mods.map(mod => {
        if (isBuiltIn(mod)) {
            return null;
        }
        const hex = integrityHex(mod.integrity);
        return fetchVerifiedFile(store, `${mod.url}${ENTRY_FILE}`, contentName(hex, ENTRY_FILE), hex);
    }));
    const packages = [];
    for (const [position, mod] of list.mods.entries()) {
        if (isBuiltIn(mod)) {
            packages.push(builtInPackage(mod, byName));
            continue;
        }
        // Remote mode never hosts a sim, so a mod's sim part stays unevaluated here.
        packages.push(instantiatePackage(await importBundle(sources[position]), mod.parts, false));
    }
    return packages;
}
