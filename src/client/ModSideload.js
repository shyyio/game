// Loads the mod packages named by `?mod=<url>` (comma-separated) into local play, after the loadout
// built into this client. Remote mode ignores the parameter: a server's loadout is exactly what that
// server pins, or the positional wire ids desynchronise.
//
// A side-loaded bundle is code from a URL, evaluated with this page's origin and everything in it —
// the signed-in session token included — so only a build with the dev tools on honours the
// parameter. The public site ignores it: a link is not consent to run a stranger's code.

import {ModPackage} from "@/common/ModPackage.js";
import {ModManifest, SDK_VERSION, MOD_PART_SIM, MOD_PART_CLIENT} from "@/common/ModManifest.js";
import {importBundle} from "@/client/ModFetcher.js";
import {DEV_TOOLS} from "@/common/env.js";
import * as sdk from "@/sdk/client.js";

// Side-loads packages: ?mod=http://localhost:5050/mod/
export const MOD_PARAM = "mod";

/**
 * The package base URLs the current location asks for, empty in a build without the dev tools.
 * @returns {string[]}
 */
export function sideloadedModUrls() {
    if (!DEV_TOOLS) {
        return [];
    }
    const value = new URLSearchParams(window.location.search).get(MOD_PARAM);
    if (value === null) {
        return [];
    }
    return value.split(",").filter(url => url.length > 0);
}

/**
 * @param {string} baseUrl the package directory holding mod.json
 * @returns {Promise<ModPackage>}
 */
async function fetchPackage(baseUrl) {
    const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    const response = await fetch(`${base}mod.json`);
    if (!response.ok) {
        throw new Error(`No mod package at ${base} (${response.status})`);
    }
    const manifest = ModManifest.parse(await response.json());
    if (manifest.sdkVersion !== SDK_VERSION) {
        throw new Error(
            `Mod "${manifest.name}" is built for game SDK ${manifest.sdkVersion}; this client speaks ${SDK_VERSION}`,
        );
    }
    const bundleResponse = await fetch(`${base}${manifest.entry}`);
    if (!bundleResponse.ok) {
        throw new Error(`Could not download ${base}${manifest.entry} (${bundleResponse.status})`);
    }
    const bundle = await importBundle(new Uint8Array(await bundleResponse.arrayBuffer()));
    // Local mode hosts the sim in this page, so every part is evaluated here — a remote join leaves
    // the sim part to the server.
    const sim = manifest.has(MOD_PART_SIM) ? bundle.createSim(sdk) : null;
    const client = manifest.has(MOD_PART_CLIENT) ? bundle.createClient(sdk) : null;
    return new ModPackage(bundle.createDeclaration(sdk), {sim, client});
}

/**
 * The side-loaded mods, as ModPackages in the order the URLs were given.
 * @param {string[]} urls package base URLs
 * @returns {Promise<ModPackage[]>}
 */
export async function fetchSideloadedMods(urls) {
    const packages = [];
    for (const url of urls) {
        packages.push(await fetchPackage(url));
    }
    return packages;
}
