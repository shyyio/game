#!/usr/bin/env node
// Runs a mod in the real game, locally:
//
//   spup-dev client [--port 8080] [--host 127.0.0.1] [--mod <dir>] [--out <dir>]
//   spup-dev server [--port 27500] [--host 0.0.0.0] [--work <dir>] [--mod <dir>] [--out <dir>]
//
// The mod is the working directory unless --mod says otherwise.
//
// `client` builds the mod the same way `spup-mod-builder build` does, serves the prebuilt client
// next to the built package, and points the client at it with `?mod=`. Local play only: a server
// runs exactly the loadout it pins, so the client ignores `?mod=` on a remote join.
//
// `server` runs a real game server — persistence, claims, several players — with the base mods and
// yours pinned into a lockfile. It needs @spup/game-server, which carries the native dependencies a
// client-only author never has to install.

import {existsSync, mkdtempSync, readFileSync, watch} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join, relative, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {buildMod} from "@spup/mod-builder/build";
import {MOD_MOUNT, startDevServer} from "./lib/devServer.js";

const USAGE = [
    "usage:",
    "  spup-dev client [--port 8080] [--host 127.0.0.1] [--mod <dir>] [--out <dir>]",
    "  spup-dev server [--port 27500] [--host 0.0.0.0] [--work <dir>] [--mod <dir>] [--out <dir>]",
].join("\n");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = join(HERE, "dist");
const DEFAULT_PORT = 8080;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_GAME_PORT = 27500;
const DEFAULT_GAME_HOST = "0.0.0.0";
// Where a dev server keeps its lockfile, mod cache and world; beside the mod, so a world survives
// restarts and is one directory to delete.
const WORK_DIR_NAME = ".spup-dev";
// A dev build is not a release; the version only has to parse.
const FALLBACK_VERSION = "0.0.0";
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
// Long enough that an editor writing several files in a row rebuilds once.
const REBUILD_DELAY_MS = 150;
const IGNORED_DIRS = ["node_modules", ".git"];

/**
 * @param {string[]} argv
 * @returns {Map<string, string>}
 */
function parseFlags(argv) {
    const flags = new Map();
    for (let index = 0; index < argv.length; index += 2) {
        if (!argv[index].startsWith("--") || argv[index + 1] === undefined) {
            throw new Error(`Bad argument: ${argv[index]}`);
        }
        flags.set(argv[index].slice(2), argv[index + 1]);
    }
    return flags;
}

/**
 * The mod's own package version when it has one, so a dev build carries the version it will ship as.
 * @param {string} modDir
 * @returns {string}
 */
function versionOf(modDir) {
    const path = join(modDir, "package.json");
    if (!existsSync(path)) {
        return FALLBACK_VERSION;
    }
    const {version} = JSON.parse(readFileSync(path, "utf8"));
    if (typeof version !== "string" || !VERSION_PATTERN.test(version)) {
        return FALLBACK_VERSION;
    }
    return version;
}

/**
 * @param {string} modDir
 * @param {string} outDir
 * @returns {Promise<boolean>} whether the build succeeded
 */
async function build(modDir, outDir) {
    try {
        // Unminified: a dev build is read in devtools and rebuilt on every save, never downloaded.
        const manifest = await buildMod(modDir, outDir, {version: versionOf(modDir), minify: false});
        console.log(`built ${manifest.name} ${manifest.version} (sdk ${manifest.sdkVersion}), parts: ${manifest.parts.join(", ")}`);
        return true;
    } catch (error) {
        console.error(`build failed: ${error.message}`);
        return false;
    }
}

/**
 * Rebuilds on every save under the mod directory, one build at a time. The browser is not reloaded:
 * refresh the page to pick the new build up.
 * @param {string} modDir
 * @param {string} outDir
 * @param {function(): Promise<void>} [onBuilt] runs after each successful rebuild
 * @param {string[]} [ignoredDirs] absolute directories whose writes are not source changes
 * @returns {void}
 */
function watchMod(modDir, outDir, onBuilt=null, ignoredDirs=[]) {
    let timer = null;
    let building = false;
    let again = false;

    async function rebuild() {
        if (building) {
            again = true;
            return;
        }
        building = true;
        const built = await build(modDir, outDir);
        if (built && onBuilt !== null) {
            await onBuilt();
        }
        building = false;
        if (again) {
            again = false;
            await rebuild();
        }
    }

    watch(modDir, {recursive: true}, (event, name) => {
        if (name === null) {
            return;
        }
        const first = name.split(/[\\/]/)[0];
        if (IGNORED_DIRS.includes(first)) {
            return;
        }
        const changed = resolve(modDir, name);
        const generated = [outDir, ...ignoredDirs].some(dir => !relative(dir, changed).startsWith(".."));
        if (generated) {
            return;
        }
        if (timer !== null) {
            clearTimeout(timer);
        }
        timer = setTimeout(rebuild, REBUILD_DELAY_MS);
    });
}

/**
 * The mod directory — where the command was run, unless told otherwise — and the package directory
 * to build it into.
 * @param {Map<string, string>} flags
 * @returns {{modDir: string, outDir: string}}
 */
function directoriesFor(flags) {
    const modDir = resolve(flagOr(flags, "mod", process.cwd()));
    if (!existsSync(join(modDir, "declaration.js"))) {
        throw new Error(`${modDir} holds no declaration.js: run this in a mod, or point --mod at one`);
    }
    if (flags.get("out") === undefined) {
        return {modDir, outDir: mkdtempSync(join(tmpdir(), "spup-dev-"))};
    }
    return {modDir, outDir: resolve(flags.get("out"))};
}

/**
 * @param {Map<string, string>} flags
 * @param {string} name
 * @param {*} fallback
 * @returns {*}
 */
function flagOr(flags, name, fallback) {
    if (flags.get(name) === undefined) {
        return fallback;
    }
    return flags.get(name);
}

/**
 * @param {Map<string, string>} flags
 * @returns {Promise<void>}
 */
async function runClient(flags) {
    if (!existsSync(CLIENT_DIR)) {
        throw new Error(`${CLIENT_DIR} is missing: this install ships no client bundle (in a game checkout, run \`npm run pack:client\`)`);
    }
    const {modDir, outDir} = directoriesFor(flags);
    if (!await build(modDir, outDir)) {
        process.exit(1);
    }
    const port = Number(flagOr(flags, "port", DEFAULT_PORT));
    const host = flagOr(flags, "host", DEFAULT_HOST);
    await startDevServer({clientDir: CLIENT_DIR, modDir: outDir, port, host});
    watchMod(modDir, outDir);
    console.log(`serving ${modDir} at ${MOD_MOUNT}`);
    console.log(`open http://${host}:${port}/play?mod=${MOD_MOUNT}`);
}

/**
 * @param {Map<string, string>} flags
 * @returns {Promise<void>}
 */
async function runServer(flags) {
    let startDevGameServer;
    try {
        ({startDevGameServer} = await import("@spup/game-server/dev"));
    } catch (error) {
        throw new Error(`\`spup-dev server\` needs @spup/game-server: npm i -D @spup/game-server (${error.message})`);
    }
    const {modDir, outDir} = directoriesFor(flags);
    if (!await build(modDir, outDir)) {
        process.exit(1);
    }
    const port = Number(flagOr(flags, "port", DEFAULT_GAME_PORT));
    const workDir = resolve(flagOr(flags, "work", join(modDir, WORK_DIR_NAME)));
    const server = startDevGameServer({
        modPackageDir: outDir,
        workDir,
        port,
        host: flagOr(flags, "host", DEFAULT_GAME_HOST),
        origin: flags.get("origin"),
        authServer: flags.get("auth-server"),
    });
    // Every rebuild re-pins the mod, which means a new lockfile and a fresh boot. The work
    // directory is the server writing its world, not the author saving a file.
    watchMod(modDir, outDir, () => server.restart(), [workDir]);
    for (const signal of ["SIGINT", "SIGTERM"]) {
        process.on(signal, async () => {
            await server.stop();
            process.exit(0);
        });
    }
    console.log(`game server on ws://localhost:${port} — join it from the client's "Connect to a URL" field`);
}

const [verb, ...rest] = process.argv.slice(2);
if (verb === "client") {
    await runClient(parseFlags(rest));
} else if (verb === "server") {
    await runServer(parseFlags(rest));
} else {
    console.error(USAGE);
    process.exitCode = 1;
}
