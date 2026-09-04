import {timingSafeEqual} from "node:crypto";
import {existsSync, readFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {readJson, rejectRequest, respondJson} from "@/nodeservice/AbstractHttpServer.js";
import {ServerConfig} from "@/common/ServerConfig.js";
import {writeServerConfig} from "@/server/serverConfigFile.js";
import {LoadoutChangeRefused} from "@/server/ServerRuntime.js";
import {ModCache} from "@/server/ModCache.js";
import {extensionOf} from "@/server/ModHost.js";

const PAGE_FILE = "admin.html";
const BEARER = "Bearer ";

// What the admin page may be built out of; a mod package's own table is MOD_CONTENT_TYPES.
/** @enum */
const CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".woff2": "font/woff2",
    ".json": "application/json",
};

/**
 * The path a /admin/ URL names. uWS hands the URL undecoded, and a client may send anything.
 * @param {string} url
 * @returns {string|null} null when the escapes are malformed
 */
function adminFileOf(url) {
    try {
        return decodeURIComponent(url.slice("/admin/".length));
    } catch (error) {
        return null;
    }
}

/**
 * @param {string} given
 * @param {string} expected
 * @returns {boolean} equal, in time independent of where they differ
 */
function tokenMatches(given, expected) {
    const left = Buffer.from(given);
    const right = Buffer.from(expected);
    if (left.length !== right.length) {
        return false;
    }
    return timingSafeEqual(left, right);
}

/**
 * The operator's admin page and its JSON API, under /admin on the game server's own port. The API
 * needs the config's admin token; what it saves, pinned mods included, goes live through the
 * runtime at once.
 */
export class AdminRoutes {

    /**
     * @param {object} options
     * @param {string} options.configPath where a saved config goes
     * @param {ServerConfig} options.saved the config file as it stands
     * @param {string[]} options.pinned fields a command-line flag overrode, read-only on the page
     * @param {ServerRuntime} options.runtime
     * @param {string} options.adminDir the built admin page
     * @param {ModLockfile|null} options.builtMods the base mods this build ships, pinned; null when none are built
     * @param {string} options.distMods where those builds are looked for
     */
    constructor({
            configPath,
            saved,
            pinned,
            runtime,
            adminDir,
            builtMods,
            distMods}) {
        this._configPath = configPath;
        this._saved = saved;
        this._pinned = pinned;
        this._runtime = runtime;
        this._adminDir = resolve(adminDir);
        this._builtMods = builtMods;
        this._distMods = resolve(distMods);
        /**
         * Path -> its bytes. The page is static for the life of the process, and reading it off disk
         * on every request reads it on the tick thread.
         * @type {Map<string, Buffer>}
         */
        this._files = new Map();
    }

    /**
     * Registers the routes; call before any catch-all route.
     * @param {object} app a uWS.App
     * @returns {void}
     */
    registerRoutes(app) {
        app.get("/admin/api/state", (res, req) => {
            if (!this._authorized(res, req)) {
                return;
            }
            respondJson(res, this._state());
        });
        app.put("/admin/api/config", (res, req) => {
            if (!this._authorized(res, req)) {
                return;
            }
            const convert = req.getQuery("convert") === "1";
            readJson(res, json => {
                this._saveConfig(res, json, convert).catch(error => {
                    rejectRequest(res, "500 Internal Server Error", error.message);
                });
            });
        });
        app.post("/admin/api/reset", (res, req) => {
            if (!this._authorized(res, req)) {
                return;
            }
            readJson(res, json => {
                this._resetWorld(res, json).catch(error => {
                    rejectRequest(res, "500 Internal Server Error", error.message);
                });
            });
        });
        app.get("/admin", (res, req) => {
            this._serveFile(res, PAGE_FILE);
        });
        app.get("/admin/*", (res, req) => {
            const file = adminFileOf(req.getUrl());
            if (file === null) {
                rejectRequest(res, "404 Not Found", "No such admin file");
                return;
            }
            if (file === "") {
                this._serveFile(res, PAGE_FILE);
                return;
            }
            this._serveFile(res, file);
        });
    }

    /**
     * @private
     * @param {object} res
     * @param {object} req
     * @returns {boolean} whether the request carries the admin token; rejected already when not
     */
    _authorized(res, req) {
        const header = req.getHeader("authorization");
        const expected = this._runtime.running.adminToken;
        if (expected !== null && header.startsWith(BEARER) && tokenMatches(header.slice(BEARER.length), expected)) {
            return true;
        }
        rejectRequest(res, "401 Unauthorized", "Admin token required");
        return false;
    }

    /**
     * @private
     * @returns {object}
     */
    _state() {
        let builtMods = null;
        if (this._builtMods !== null) {
            builtMods = this._builtMods.toJSON().mods;
        }
        return {
            saved: this._saved.toPublicJSON(),
            running: this._runtime.running.toPublicJSON(),
            pinned: this._pinned,
            world: {loaded: this._runtime.world.loaded, seed: this._runtime.world.game.seed},
            builtMods,
            distMods: this._distMods,
            baseDir: this._runtime.baseDir,
        };
    }

    /**
     * Fills the cache with any new pins, applies, then writes: a config the runtime refuses never
     * reaches the file. A mod change that would lose part of the world comes back as the losses
     * (409) until the request carries convert=1.
     * @private
     * @param {object} res
     * @param {object} json
     * @param {boolean} convert
     * @returns {Promise<void>}
     */
    async _saveConfig(res, json, convert) {
        const config = this._parseConfig(res, json);
        if (config === null) {
            return;
        }
        const world = this._runtime.world;
        if (world.loaded && config.seed !== null && config.seed !== world.game.seed) {
            rejectRequest(res, "400 Bad Request", `The saved world keeps its seed ${world.game.seed}`);
            return;
        }
        await this._commit(res, config, () => this._runtime.apply(config, {convert}));
    }

    /**
     * Throws the saved world away and starts a fresh one on the config given, which may change
     * anything a saved world pins down.
     * @private
     * @param {object} res
     * @param {object} json
     * @returns {Promise<void>}
     */
    async _resetWorld(res, json) {
        const config = this._parseConfig(res, json);
        if (config === null) {
            return;
        }
        await this._commit(res, config, () => this._runtime.resetWorld(config));
    }

    /**
     * @private
     * @param {object} res
     * @param {object} json
     * @returns {ServerConfig|null} null once the request has been rejected
     */
    _parseConfig(res, json) {
        try {
            if (json !== null && typeof json === "object" && json.adminToken === undefined) {
                json.adminToken = this._runtime.running.adminToken;
            }
            return ServerConfig.parse(json);
        } catch (error) {
            rejectRequest(res, "400 Bad Request", error.message);
            return null;
        }
    }

    /**
     * Fills the cache with any new pins, runs `applyToRuntime`, and writes the config only once
     * that succeeded.
     * @private
     * @param {object} res
     * @param {ServerConfig} config
     * @param {function(): Promise<string[]>} applyToRuntime
     * @returns {Promise<void>}
     */
    async _commit(res, config, applyToRuntime) {
        let restart;
        try {
            if (config.mods !== null && this._runtime.running.diff(config).includes("mods")) {
                await new ModCache(this._runtime.resolvePaths(config).modsCache).populate(config.lockfile);
            }
            restart = await applyToRuntime();
        } catch (error) {
            if (res.aborted) {
                return;
            }
            if (error instanceof LoadoutChangeRefused) {
                res.cork(() => {
                    res.writeStatus("409 Conflict").writeHeader("Content-Type", "application/json")
                        .end(JSON.stringify({losses: error.losses}));
                });
                return;
            }
            rejectRequest(res, "400 Bad Request", error.message);
            return;
        }
        writeServerConfig(config, this._configPath);
        this._saved = config;
        if (!res.aborted) {
            respondJson(res, {restart});
        }
    }

    /**
     * @private
     * @param {object} res
     * @param {string} file relative to the admin directory
     * @returns {void}
     */
    _serveFile(res, file) {
        const path = resolve(join(this._adminDir, file));
        const contentType = CONTENT_TYPES[extensionOf(path)];
        if (!path.startsWith(`${this._adminDir}/`) || contentType === undefined) {
            rejectRequest(res, "404 Not Found", `No /admin/${file}`);
            return;
        }
        let body = this._files.get(path);
        if (body === undefined) {
            if (!existsSync(path)) {
                rejectRequest(res, "404 Not Found", `No /admin/${file}`);
                return;
            }
            body = readFileSync(path);
            this._files.set(path, body);
        }
        res.cork(() => {
            res.writeHeader("Content-Type", contentType).end(body);
        });
    }
}
