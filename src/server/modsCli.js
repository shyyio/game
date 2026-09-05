// The operator's mod CLI over the external mods in server.json: read them, and re-check the local
// cache. Choosing a mod is the admin page's job, which resolves it against the registry's published
// hashes; this is for scripts and deploys.
//
//   node src/server/modsCli.js list
//   node src/server/modsCli.js verify

import {dirname, resolve} from "node:path";
import {parseArgs} from "node:util";
import {readServerConfigOrDefault, resolveConfigPaths} from "@/server/serverConfigFile.js";
import {ModCache} from "@/server/ModCache.js";

const {values: args, positionals} = parseArgs({
    allowPositionals: true,
    options: {
        "config": {type: "string", default: "server.json"},
    },
});

const USAGE = [
    "usage:",
    "  mods list",
    "  mods verify",
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

const [verb] = positionals;
const config = readServerConfigOrDefault(args["config"]);
const lockfile = config.lockfile;
try {
    if (verb === "list") {
        list(lockfile);
    } else if (verb === "verify") {
        verify(lockfile);
    } else {
        console.error(USAGE);
        process.exitCode = 1;
    }
} catch (error) {
    // A stack trace helps nobody here: every throw above is a message written for the operator.
    console.error(error.message);
    process.exitCode = 1;
}
