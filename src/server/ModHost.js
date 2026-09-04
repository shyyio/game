// Serves this server's loadout to joining clients: the mod index, and every packaged file under its
// content hash. Clients fetch mods from the server they are joining, never from the mod author's
// host — no third-party CORS or availability dependency, and the hash comes from the same place as
// the code either way.

import {SDK_VERSION} from "@/common/ModManifest.js";

/** @enum */
export const MOD_CONTENT_TYPES = {
    ".js": "text/javascript; charset=utf-8",
};

/**
 * @param {string} fileName
 * @returns {string} the extension, including its dot
 */
export function extensionOf(fileName) {
    return fileName.slice(fileName.lastIndexOf("."));
}

export class ModHost {

    /**
     * @param {PackagedMod[]} mods in loadout order
     * @param {ModCache} cache
     */
    constructor(
        mods,
        cache,
    ) {
        this._index = JSON.stringify({
            sdkVersion: SDK_VERSION,
            mods: mods.map(mod => ({
                name: mod.manifest.name,
                version: mod.manifest.version,
                parts: mod.manifest.parts,
                entry: mod.contentNameOf(mod.manifest.entry),
            })),
        });
        // Pinned files are small and few; holding them in memory keeps serving them a map lookup,
        // and means only names the loadout pins can ever be served.
        this._files = new Map();
        for (const mod of mods) {
            for (const file of mod.manifest.files) {
                const name = mod.contentNameOf(file);
                if (MOD_CONTENT_TYPES[extensionOf(name)] === undefined) {
                    throw new Error(`Mod "${mod.manifest.name}" ships ${file}, which is not a servable type`);
                }
                this._files.set(name, cache.read(name));
            }
        }
    }

    /**
     * @returns {string} the index a client consumes
     */
    get indexJson() {
        return this._index;
    }

    /**
     * @param {string} name a content-addressed file name
     * @returns {Uint8Array|undefined} the pinned file, or undefined for a name the loadout does not pin
     */
    fileOf(name) {
        return this._files.get(name);
    }
}
