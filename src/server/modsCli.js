// The operator's mod CLI over the pins in server.json: read them, re-check the local cache, and
// re-pin the base mods a build ships. Pinning a third-party mod is the admin page's job, which
// resolves it against the registry's published hashes; this is for scripts and deploys.
//
//   node src/server/modsCli.js list
//   node src/server/modsCli.js verify
//   node src/server/modsCli.js sync-base --dist-mods build/mods

import {dirname, resolve} from "node:path";
import {parseArgs} from "node:util";
import {pinBuiltMods} from "@/server/builtMods.js";
import {ServerConfig} from "@/common/ServerConfig.js";
import {readServerConfigOrDefault, resolveConfigPaths, writeServerConfig} from "@/server/serverConfigFile.js";
import {ModCache} from "@/server/ModCache.js";

const {values: args, positionals} = parseArgs({
    allowPositionals: true,
    options: {
        "config": {type: "string", default: "server.json"},
        "dist-mods": {type: "string"},
    },
});

const USAGE = [
    "usage:",
    "  mods list",
    "  mods verify",
    "  mods sync-base --dist-mods <dir>",
    "options: --config <server.json>",
].join("\n");

/**
 * @param {ModLockfile} lockfile
 * @returns {void}
 */
function list(lockfile) {
    if (lockfile.mods.length === 0) {
        console.log(`${args["config"]} pins no mods`);
        return;
    }
    for (const [index, entry] of lockfile.mods.entries()) {
        console.log(`${index}. ${entry.name} ${entry.version}  ${entry.url}`);
    }
}

/**
 * @param {ModLockfile} lockfile
 * @returns {void}
 */
function verify(lockfile) {
    const cacheDir = resolveConfigPaths(config, dirname(resolve(args["config"]))).modsCache;
    const problems = new ModCache(cacheDir).verify(lockfile);
    if (problems.length === 0) {
        console.log(`${cacheDir} matches ${args["config"]}`);
        return;
    }
    console.error(`${cacheDir} does not match ${args["config"]}:`);
    for (const problem of problems) {
        console.error(problem);
    }
    process.exitCode = 1;
}

/**
 * Pins the base mods a build ships, read in the order its order.json lists them: a config that
 * already pins keeps every position and every other mod and takes any new base mod at the end, one
 * that pins nothing starts as the full base list.
 * @param {ModLockfile} lockfile
 * @returns {Promise<void>}
 */
async function syncBase(lockfile) {
    const distMods = args["dist-mods"];
    if (distMods === undefined) {
        throw new Error("sync-base needs --dist-mods <dir>");
    }
    const built = await pinBuiltMods(distMods);
    if (built === null) {
        throw new Error(`${distMods} holds no built mods`);
    }
    let synced = built;
    if (lockfile.mods.length > 0) {
        synced = lockfile.withUpdated(built);
    }
    writePins(synced);
    console.log(`${args["config"]}: ${synced.mods.length} mods pinned, ${built.mods.length} base mods from ${distMods}`);
}

/**
 * Writes the pins back into the config, leaving every other setting as it was.
 * @param {ModLockfile} lockfile
 * @returns {void}
 */
function writePins(lockfile) {
    const json = config.toJSON();
    json.mods = lockfile.toJSON().mods;
    writeServerConfig(ServerConfig.parse(json), args["config"]);
}

const [verb] = positionals;
const config = readServerConfigOrDefault(args["config"]);
const lockfile = config.lockfile;
try {
    if (verb === "list") {
        list(lockfile);
    } else if (verb === "verify") {
        verify(lockfile);
    } else if (verb === "sync-base") {
        await syncBase(lockfile);
    } else {
        console.error(USAGE);
        process.exitCode = 1;
    }
} catch (error) {
    // A stack trace helps nobody here: every throw above is a message written for the operator.
    console.error(error.message);
    process.exitCode = 1;
}
