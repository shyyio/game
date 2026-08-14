// The published registry catalog, as the server CLI sees it: `mods add <name>` resolves a name to
// the package URL of its newest published version. Unlisted mods stay first-class —
// `mods add <url>` needs no catalog at all.

import {fetchPackageFile} from "@/server/ModCache.js";

export const DEFAULT_REGISTRY_URL = "https://mods.spupgame.com/index.json";

/**
 * One published version of a listed mod.
 */
export class CatalogVersion {

    /**
     * @param {string} version
     * @param {string} url the package's base URL
     */
    constructor(
        version,
        url,
    ) {
        this.version = version;
        this.url = url;
    }
}

/**
 * One listed mod.
 */
export class CatalogEntry {

    /**
     * @param {string} name
     * @param {string} description
     * @param {CatalogVersion[]} versions oldest first
     */
    constructor(
        name,
        description,
        versions,
    ) {
        this.name = name;
        this.description = description;
        this.versions = versions;
    }

    /**
     * The newest published version.
     * @returns {CatalogVersion|null}
     */
    get latest() {
        if (this.versions.length === 0) {
            return null;
        }
        return this.versions[this.versions.length - 1];
    }

    /**
     * @param {string} version
     * @returns {CatalogVersion|null}
     */
    find(version) {
        const found = this.versions.find(candidate => candidate.version === version);
        if (found === undefined) {
            return null;
        }
        return found;
    }
}

export class ModCatalog {

    /**
     * @param {CatalogEntry[]} mods
     */
    constructor(mods) {
        this.mods = mods;
    }

    /**
     * The package URL for `name`, or `name@version`.
     * @param {string} spec
     * @returns {{entry: CatalogEntry, version: CatalogVersion}}
     */
    resolve(spec) {
        const at = spec.indexOf("@");
        const name = at === -1 ? spec : spec.slice(0, at);
        const wanted = at === -1 ? null : spec.slice(at + 1);
        const entry = this.mods.find(candidate => candidate.name === name);
        if (entry === undefined) {
            throw new Error(`The registry lists no mod called "${name}"`);
        }
        if (wanted === null) {
            const latest = entry.latest;
            if (latest === null) {
                throw new Error(`"${name}" has no published version`);
            }
            return {entry, version: latest};
        }
        const version = entry.find(wanted);
        if (version === null) {
            throw new Error(`"${name}" has no published version ${wanted}`);
        }
        return {entry, version};
    }

    /**
     * @param {object} json a published index.json
     * @returns {ModCatalog}
     */
    static parse(json) {
        if (json === null || typeof json !== "object" || !Array.isArray(json.mods)) {
            throw new Error("The registry index is malformed");
        }
        return new ModCatalog(json.mods.map(mod => new CatalogEntry(
            mod.name,
            mod.description,
            mod.versions.map(version => new CatalogVersion(version.version, version.url)),
        )));
    }

    /**
     * @param {string} url
     * @param {function(string): Promise<Uint8Array>} [fetchFile]
     * @returns {Promise<ModCatalog>}
     */
    static async fetch(url, fetchFile = fetchPackageFile) {
        return ModCatalog.parse(JSON.parse(new TextDecoder().decode(await fetchFile(url))));
    }
}
