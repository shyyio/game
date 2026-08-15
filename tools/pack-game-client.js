// Stages packages/game-client/dist/ from a production build of this repo's client, so the
// published package plays the same game the site serves. The one difference is deliberate: the
// package's client is built with the dev tools on (a "connect to a URL" field on the server list),
// which production does not ship.
//
//   node tools/pack-game-client.js [--check]
//
// --check only verifies that what is staged was built from this commit, so a stale bundle fails CI.

import {cpSync, existsSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {join, resolve, dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {parseArgs} from "node:util";
import {gitBuildInfo} from "../vite.build-defines.js";
import {GAME_VERSION} from "../src/common/constants.js";
import {syncPackageVersion} from "./packageVersion.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Its own output directory: this build has the dev tools on, and must never be mistaken for the
// one the site deploys.
const DIST_DIR = join(ROOT, "dist-devclient");
const PACKAGE_DIR = join(ROOT, "packages/game-client");
const CLIENT_DIR = join(PACKAGE_DIR, "dist");
const PACKED_FILE = join(PACKAGE_DIR, "packed.json");

/**
 * @returns {void}
 */
function pack() {
    syncPackageVersion(PACKAGE_DIR);
    const build = spawnSync("npm", ["run", "build", "--", "--outDir", DIST_DIR, "--emptyOutDir"], {
        cwd: ROOT,
        stdio: "inherit",
        env: {...process.env, "SPUP_DEV_TOOLS": "1"},
    });
    if (build.status !== 0) {
        throw new Error("the client build failed");
    }
    if (!existsSync(join(DIST_DIR, "index.html"))) {
        throw new Error(`${DIST_DIR} has no index.html; the build produced nothing to pack`);
    }
    rmSync(CLIENT_DIR, {recursive: true, force: true});
    cpSync(DIST_DIR, CLIENT_DIR, {recursive: true});
    writeFileSync(PACKED_FILE, `${JSON.stringify({commit: gitBuildInfo().commit, version: GAME_VERSION}, null, 4)}\n`);
    console.log(`packages/game-client/dist: staged from ${DIST_DIR} (game ${GAME_VERSION})`);
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
    if (!existsSync(join(CLIENT_DIR, "index.html"))) {
        reasons.push("dist/ is missing");
    }
    return reasons;
}

const {values: args} = parseArgs({options: {"check": {type: "boolean", default: false}}});
if (args.check) {
    const reasons = staleReasons();
    if (reasons.length > 0) {
        console.error(`packages/game-client is stale: ${reasons.join("; ")}`);
        console.error("run `npm run pack:client`");
        process.exitCode = 1;
    } else {
        console.log("packages/game-client is current");
    }
} else {
    pack();
}
