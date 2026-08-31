// Stages packages/game-server/ from this repo: the server bundle, the base-mod packages a dev
// server needs for real content, and the test harness a mod's specs run against.
//
//   node --import ./src/nodeservice/loader.js tools/pack-game-server.js [--check]
//
// --check only verifies that what is staged was built from this commit, so a stale bundle fails CI.

import {cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {basename, join, resolve, dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {parseArgs} from "node:util";
import {publishBaseMods} from "./publish-base-mods.js";
import {gitBuildInfo} from "../vite.build-defines.js";
import {GAME_VERSION} from "../src/common/constants.js";
import {syncPackageVersion} from "./packageVersion.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_DIR = join(ROOT, "packages/game-server");
const SERVER_DIR = join(PACKAGE_DIR, "dist");
const MODS_DIR = join(PACKAGE_DIR, "dist-mods");
const HARNESS_DIR = join(PACKAGE_DIR, "dist-harness");
const PACKED_FILE = join(PACKAGE_DIR, "packed.json");

/**
 * @param {string} script an npm script in this repo
 * @returns {void}
 */
function run(script) {
    const result = spawnSync("npm", ["run", script], {cwd: ROOT, stdio: "inherit"});
    if (result.status !== 0) {
        throw new Error(`\`npm run ${script}\` failed`);
    }
}

/**
 * @returns {Promise<void>}
 */
async function pack() {
    syncPackageVersion(PACKAGE_DIR);
    run("build:server");
    run("build:harness");

    rmSync(SERVER_DIR, {recursive: true, force: true});
    cpSync(join(ROOT, "dist-server"), SERVER_DIR, {recursive: true});
    rmSync(HARNESS_DIR, {recursive: true, force: true});
    cpSync(join(ROOT, "dist-harness"), HARNESS_DIR, {recursive: true});

    rmSync(MODS_DIR, {recursive: true, force: true});
    mkdirSync(MODS_DIR, {recursive: true});
    const lockfile = await publishBaseMods(MODS_DIR, GAME_VERSION);
    // The dev lockfile is generated per run, but its order is fixed here: it assigns the positional
    // type and wire ids, and must match the order the game itself registers.
    const order = lockfile.mods.map(entry => basename(new URL(entry.url).pathname.replace(/\/$/, "")));
    writeFileSync(join(MODS_DIR, "order.json"), `${JSON.stringify(order, null, 4)}\n`);

    writeFileSync(PACKED_FILE, `${JSON.stringify({commit: gitBuildInfo().commit, version: GAME_VERSION}, null, 4)}\n`);
    console.log(`packages/game-server: server bundle, harness, ${order.length} base mods (game ${GAME_VERSION})`);
}

/**
 * @returns {string[]} what is stale about the staged package, empty when it is current
 */
function staleReasons() {
    if (!existsSync(PACKED_FILE)) {
        return ["nothing is staged"];
    }
    const packed = JSON.parse(readFileSync(PACKED_FILE, "utf8"));
    const reasons = [];
    if (packed.commit !== gitBuildInfo().commit) {
        reasons.push(`built from ${packed.commit}, HEAD is ${gitBuildInfo().commit}`);
    }
    if (packed.version !== GAME_VERSION) {
        reasons.push(`built for game ${packed.version}, this tree is ${GAME_VERSION}`);
    }
    for (const dir of [SERVER_DIR, HARNESS_DIR, MODS_DIR]) {
        if (!existsSync(dir)) {
            reasons.push(`${basename(dir)}/ is missing`);
        }
    }
    return reasons;
}

const {values: args} = parseArgs({options: {"check": {type: "boolean", default: false}}});
if (args.check) {
    const reasons = staleReasons();
    if (reasons.length > 0) {
        console.error(`packages/game-server is stale: ${reasons.join("; ")}`);
        console.error("run `npm run pack:server`");
        process.exitCode = 1;
    } else {
        console.log("packages/game-server is current");
    }
} else {
    await pack();
}
