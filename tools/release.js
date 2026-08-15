// Publishes this repo's four packages to npm, at the version the root package.json carries.
//
//   npm run release
//
// It builds everything from source first, runs the tests and the staleness checks, and only then
// publishes — so a stale bundle cannot reach npm. Publishing is per package and irreversible, so a
// version already on the registry is skipped: a run that dies halfway is simply run again.
//
// It does not bump the version, commit, push, or deploy. Bump the root package.json, commit, then
// run this.

import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {join, resolve, dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {GAME_VERSION} from "../src/common/constants.js";
import {SDK_VERSION} from "../src/common/ModManifest.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Enough of a dirty tree to recognise it, without pasting a whole refactor into an error.
const DIRTY_FILES_SHOWN = 10;

// Dependency order: game-client names mod-builder and game-server, so a fresh install of it never
// reaches for a version that is not up yet.
const PACKAGES = [
    {dir: "sdk", pack: "pack:sdk"},
    {dir: "mod-builder", pack: "pack:builder"},
    {dir: "game-server", pack: "pack:server"},
    {dir: "game-client", pack: "pack:client"},
];

// Each pack script re-checks its own staged output; the game repo's tests cover the rest.
const CHECKS = [
    ["--import", "./src/server/loader.js", "tools/pack-builder.js", "--check"],
    ["--import", "./src/server/loader.js", "tools/pack-sdk.js", "--check"],
    ["--import", "./src/server/loader.js", "tools/pack-game-server.js", "--check"],
    ["tools/pack-game-client.js", "--check"],
];

/**
 * Runs a command, failing the release on anything but a clean exit.
 * @param {string} command
 * @param {string[]} args
 * @param {string} [cwd]
 * @returns {void}
 */
function run(command, args, cwd=ROOT) {
    const result = spawnSync(command, args, {cwd, stdio: "inherit"});
    if (result.status !== 0) {
        throw new Error(`${command} ${args.join(" ")} failed`);
    }
}

/**
 * @param {string} command
 * @param {string[]} args
 * @returns {{status: number, stdout: string}}
 */
function capture(command, args) {
    const result = spawnSync(command, args, {cwd: ROOT, encoding: "utf8"});
    return {status: result.status, stdout: result.stdout.trim()};
}

/**
 * @param {string} dir a directory under packages/
 * @returns {{name: string, version: string}}
 */
function manifestOf(dir) {
    const {name, version} = JSON.parse(readFileSync(join(ROOT, "packages", dir, "package.json"), "utf8"));
    return {name, version};
}

/**
 * Stops the release while the tree still holds uncommitted work: what goes to npm has to be a
 * commit someone can check out again.
 * @param {string} when for the error message
 * @returns {void}
 */
function assertCommitted(when) {
    const {stdout} = capture("git", ["status", "--porcelain"]);
    if (stdout === "") {
        return;
    }
    const changed = stdout.split("\n");
    const shown = changed.slice(0, DIRTY_FILES_SHOWN).join("\n");
    let rest = "";
    if (changed.length > DIRTY_FILES_SHOWN) {
        rest = `\n  ...and ${changed.length - DIRTY_FILES_SHOWN} more`;
    }
    throw new Error(`the working tree has uncommitted changes ${when}:\n${shown}${rest}`);
}

/**
 * @param {string} name
 * @param {string} version
 * @returns {boolean} whether npm already serves this exact version
 */
function isPublished(name, version) {
    const {status, stdout} = capture("npm", ["view", `${name}@${version}`, "version"]);
    return status === 0 && stdout !== "";
}

assertCommitted("before packing");
console.log(`releasing ${GAME_VERSION} (SDK ${SDK_VERSION})`);

for (const {pack} of PACKAGES) {
    run("npm", ["run", pack]);
}
// The pack scripts write the game version into three of the manifests; if that changed anything,
// the commit being released no longer matches what is about to be published.
assertCommitted("after packing");

run("npm", ["test"]);
for (const args of CHECKS) {
    run("node", args);
}

for (const {dir} of PACKAGES) {
    const {name, version} = manifestOf(dir);
    if (isPublished(name, version)) {
        console.log(`${name} ${version} is already published`);
        continue;
    }
    // Scoped packages publish privately unless told otherwise, which fails every install but yours.
    run("npm", ["publish", "--access", "public"], join(ROOT, "packages", dir));
    console.log(`published ${name} ${version}`);
}

const tag = `v${GAME_VERSION}`;
if (capture("git", ["tag", "--list", tag]).stdout === "") {
    run("git", ["tag", tag]);
    console.log(`tagged ${tag} — push it with \`git push all ${tag}\``);
}
