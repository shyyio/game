// Runs the real game server against the mod being worked on: the base mods this package ships plus
// that mod, pinned into a lockfile and booted exactly the way an operator's server boots. Nothing
// here is dev-only engine behavior — it is the shipped server with a generated `mods.json`.

import {spawn} from "node:child_process";
import {mkdirSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {writeDevLockfile} from "./lockfile.js";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_ENTRY = join(PACKAGE_ROOT, "dist/main.js");
const MODS_DIR = join(PACKAGE_ROOT, "dist-mods");

export const DEFAULT_GAME_PORT = 27500;
// Where join tokens are minted and their signing keys published; a dev server verifies against the
// same auth server the official client signs in to.
export const DEFAULT_AUTH_SERVER = "https://auth.spupgame.com";

/**
 * The server process, restartable so a rebuilt mod can be re-pinned.
 */
export class DevGameServer {

    /**
     * @param {object} options
     * @param {string} options.modPackageDir the built mod to run
     * @param {string} options.workDir where the lockfile, mod cache and world database go
     * @param {number} options.port
     * @param {string} options.host
     * @param {string} options.origin what a join token must be minted for
     * @param {string} options.authServer
     */
    constructor({
            modPackageDir,
            workDir,
            port,
            host,
            origin,
            authServer}) {
        this._modPackageDir = modPackageDir;
        this._workDir = workDir;
        this._port = port;
        this._host = host;
        this._origin = origin;
        this._authServer = authServer;
        this._child = null;
    }

    /**
     * Pins the current build and starts the server.
     * @returns {void}
     */
    start() {
        mkdirSync(this._workDir, {recursive: true});
        writeDevLockfile(join(this._workDir, "mods.json"), MODS_DIR, this._modPackageDir);
        this._child = spawn(process.execPath, [
            SERVER_ENTRY,
            "--mods", join(this._workDir, "mods.json"),
            "--mods-cache", join(this._workDir, "mods-cache"),
            "--db", join(this._workDir, "world.sqlite3"),
            "--metrics-db", join(this._workDir, "metrics.sqlite3"),
            "--host", this._host,
            "--port", String(this._port),
            "--origin", this._origin,
            "--auth-server", this._authServer,
        ], {stdio: "inherit"});
    }

    /**
     * Re-pins the rebuilt mod and restarts; the world database survives, but a loadout whose object
     * types changed will refuse to load it (delete the work directory to start over).
     * @returns {Promise<void>}
     */
    async restart() {
        await this.stop();
        this.start();
    }

    /**
     * @returns {Promise<void>} once the process is gone
     */
    stop() {
        if (this._child === null) {
            return Promise.resolve();
        }
        const child = this._child;
        this._child = null;
        return new Promise(resolveStopped => {
            child.once("exit", () => resolveStopped());
            child.kill("SIGINT");
        });
    }
}

/**
 * Starts a dev server for a built mod package.
 * @param {object} options see {@link DevGameServer}; port/host/origin/authServer are optional
 * @returns {DevGameServer}
 */
export function startDevGameServer(options) {
    let port = DEFAULT_GAME_PORT;
    if (options.port !== undefined) {
        port = options.port;
    }
    let host = "0.0.0.0";
    if (options.host !== undefined) {
        host = options.host;
    }
    // The origin is what a join token is minted for, so it is the URL the player types, not the
    // interface the server listens on.
    let origin = `ws://localhost:${port}`;
    if (options.origin !== undefined) {
        origin = options.origin;
    }
    let authServer = DEFAULT_AUTH_SERVER;
    if (options.authServer !== undefined) {
        authServer = options.authServer;
    }
    const server = new DevGameServer({
        modPackageDir: options.modPackageDir,
        workDir: options.workDir,
        port,
        host,
        origin,
        authServer,
    });
    server.start();
    return server;
}
