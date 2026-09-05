// Turns the cached packages into the server's external mods: one ModPackage per lockfile entry,
// in lockfile order (which is what assigns the positional typeIds and wireIds).

import {pathToFileURL} from "node:url";
import {ModPackage} from "@/common/ModPackage.js";
import {ModManifest, SDK_VERSION, MOD_PART_SIM} from "@/common/ModManifest.js";
import {integrityHex, contentName} from "@/common/ModIntegrity.js";
import * as sdk from "@/sdk/common.js";

/**
 * One loaded package: the entry that named it, and what its manifest declares.
 */
export class PackagedMod {

    /**
     * @param {ModLockEntry} entry
     * @param {ModManifest} manifest
     */
    constructor(
        entry,
        manifest,
    ) {
        this.entry = entry;
        this.manifest = manifest;
    }

    /**
     * The content-addressed name a package file is cached and served under.
     * @param {string} file
     * @returns {string}
     */
    contentNameOf(file) {
        return contentName(integrityHex(this.entry.integrityOf(file)), file);
    }
}

/**
 * Loads every listed mod's declaration and sim part.
 * @param {ModLockfile} lockfile
 * @param {ModCache} cache
 * @returns {Promise<{packages: ModPackage[], mods: PackagedMod[]}>}
 */
export async function loadPackagedMods(lockfile, cache) {
    const packages = [];
    const mods = [];
    for (const entry of lockfile.mods) {
        const manifest = ModManifest.parse(cache.manifestJson(entry));
        if (manifest.name !== entry.name || manifest.version !== entry.version) {
            throw new Error(
                `${entry.url} ships ${manifest.name} ${manifest.version}, but the server lists ` +
                `${entry.name} ${entry.version}`,
            );
        }
        if (manifest.sdkVersion !== SDK_VERSION) {
            throw new Error(
                `Mod "${entry.name}" is built for SDK version ${manifest.sdkVersion}; this server speaks ${SDK_VERSION}`,
            );
        }
        const packaged = new PackagedMod(entry, manifest);
        // Every file the manifest declares must be in the entry, and every one re-hashed, before
        // any of it is imported.
        for (const file of manifest.files) {
            cache.read(packaged.contentNameOf(file));
        }
        const bundlePath = cache.pathOf(packaged.contentNameOf(manifest.entry));
        const bundle = await import(/* @vite-ignore */ pathToFileURL(bundlePath).href);
        const sim = manifest.has(MOD_PART_SIM) ? bundle.createSim(sdk) : null;
        packages.push(new ModPackage(bundle.createDeclaration(sdk), {sim}));
        mods.push(packaged);
    }
    return {packages, mods};
}
