// Serves this server's loadout to joining clients: the mod index, and every packaged file under its
// content hash. Clients fetch mods from the server they are joining, never from the mod author's
// host — no third-party CORS or availability dependency, and the hash comes from the same place as
// the code either way.

const CONTENT_TYPES = {
    ".js": "text/javascript; charset=utf-8",
};

// Content-addressed files never change under their name.
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

/**
 * @param {string} fileName
 * @returns {string} the extension, including its dot
 */
function extensionOf(fileName) {
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
            sdkVersion: mods[0].manifest.sdkVersion,
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
                if (CONTENT_TYPES[extensionOf(name)] === undefined) {
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
     * Registers the mod routes; call before any catch-all route.
     * @param {object} app a uWS.App
     * @returns {void}
     */
    registerRoutes(app) {
        app.get("/mods/index.json", res => {
            res.cork(() => {
                res.writeHeader("Content-Type", "application/json")
                    .writeHeader("Access-Control-Allow-Origin", "*")
                    .end(this._index);
            });
        });
        app.get("/mods/:name", (res, req) => {
            this._onFile(res, req.getParameter(0));
        });
    }

    /**
     * @private
     * @param {object} res
     * @param {string} name
     * @returns {void}
     */
    _onFile(res, name) {
        const bytes = this._files.get(name);
        if (bytes === undefined) {
            res.cork(() => {
                res.writeStatus("404 Not Found")
                    .writeHeader("Access-Control-Allow-Origin", "*")
                    .end("no such mod file");
            });
            return;
        }
        res.cork(() => {
            res.writeHeader("Content-Type", CONTENT_TYPES[extensionOf(name)])
                .writeHeader("Cache-Control", IMMUTABLE_CACHE)
                .writeHeader("Access-Control-Allow-Origin", "*")
                .end(bytes);
        });
    }
}
