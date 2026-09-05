// Which of a server's external mods this client is willing to run. A mod bundle is evaluated from a
// blob URL, so it runs same-origin with the client and reaches everything the page can — a server
// naming a bundle is therefore a claim, not a credential. What answers it is the registry: its
// maintainer reviewed the source each published hash was built from.
//
// A built-in entry is not checked here at all. The client runs its own compiled copy for those, so
// no bytes arrive from anywhere and there is nothing to vouch for.

import {integrityHex} from "@/common/ModIntegrity.js";
import {DEV} from "@/common/env.js";
import {listMods} from "@/client/ModRegistryClient.js";
import DeviceSettings, {DEVICE_SETTING_UNVERIFIED_MODS} from "@/client/state/DeviceSettings.js";

const ENTRY_FILE = "mod.js";

// Opens the refusal, so the join screen can offer the opt-in beside it.
export const UNVERIFIED_MODS_REFUSAL = "Unverified mods on this server: ";

/**
 * Every bundle hash the registry publishes, across every listed mod and version.
 * @param {object[]} listings the registry index's mods
 * @returns {Set<string>} lowercase hex sha-256
 */
export function registryModHashes(listings) {
    const hashes = new Set();
    for (const listing of listings) {
        for (const version of listing.versions) {
            if (version.artifacts === null || typeof version.artifacts !== "object") {
                continue;
            }
            const published = version.artifacts[ENTRY_FILE];
            if (published === undefined) {
                continue;
            }
            hashes.add(integrityHex(published));
        }
    }
    return hashes;
}

/**
 * The mods a server names that no published hash covers.
 * @param {object[]} mods the served list's external mods
 * @param {Set<string>} published lowercase hex sha-256
 * @returns {string[]} their names
 */
export function unverifiedMods(mods, published) {
    return mods.filter(mod => !published.has(integrityHex(mod.integrity))).map(mod => mod.name);
}

/**
 * Refuses a server's external mods before a byte of them is evaluated, unless the player has opted
 * in. A server running only built-in mods never reaches the registry.
 * @param {object[]} mods the served list's external mods
 * @returns {Promise<void>}
 */
export async function assertModsVerified(mods) {
    if (mods.length === 0 || DEV || DeviceSettings.getBoolean(DEVICE_SETTING_UNVERIFIED_MODS, false)) {
        return;
    }
    const unverified = unverifiedMods(mods, registryModHashes(await listMods()));
    if (unverified.length === 0) {
        return;
    }
    throw new Error(`${UNVERIFIED_MODS_REFUSAL}${unverified.join(", ")}.`);
}
