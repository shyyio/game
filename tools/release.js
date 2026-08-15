// Publishes this repo's four packages to npm: the three runtime ones at the version the root
// package.json carries, and the toolchain at its own (its major is the SDK version).
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
import {StepError, StepLog, runStep, fail} from "./steps.js";

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

const PACK_HINT = [
    "That pack script stages a package under packages/. Read its output above for the file it",
    "choked on; nothing has been published, so fixing it and re-running is safe.",
].join("\n");

const CHECK_HINT = [
    "A staged package no longer matches src/. Re-run the pack scripts and commit what they change:",
    "  npm run pack:sdk && npm run pack:builder && npm run pack:server && npm run pack:client",
].join("\n");

const PUBLISH_HINT = [
    "npm refused the publish. Read its error above; the usual ones:",
    "  E401/ENEEDAUTH  not logged in. `npm whoami` should print your account, else `npm login`.",
    "  EOTP            npm wants a 2FA code. Publish that one package by hand, then re-run:",
    "                    (cd packages/<dir> && npm publish --access public --otp <code>)",
    "  E403            the account has no publish rights on the @spup scope, or that exact",
    "                  version already exists (versions are immutable — bump and re-commit).",
    "Publishing is per package and already-published versions are skipped, so re-running picks up",
    "where this stopped.",
].join("\n");

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
 * @param {string} hint
 * @returns {void}
 */
function assertCommitted(when, hint) {
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
    throw new StepError(`the working tree has uncommitted changes ${when}:\n${shown}${rest}`, hint);
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

/**
 * @returns {void}
 */
function main() {
    // One step per pack, plus the commit check, the tests, the staleness checks, and the publish.
    const steps = new StepLog(PACKAGES.length + 4);

    steps.begin("check the tree is committed");
    assertCommitted("before packing", "Commit (or stash) the listed files, then re-run.");
    console.log(`releasing ${GAME_VERSION} (SDK ${SDK_VERSION})`);

    for (const {dir, pack} of PACKAGES) {
        steps.begin(`pack ${dir}`);
        runStep(`pack ${dir}`, "npm", ["run", pack], {cwd: ROOT, hint: PACK_HINT});
    }
    // The pack scripts write the game version into three of the manifests; if that changed anything,
    // the commit being released no longer matches what is about to be published.
    steps.begin("check packing changed nothing");
    assertCommitted(
        "after packing",
        "Packing rewrote staged files, so the commit no longer matches what would be published.\n"
        + "Commit those files, then re-run.",
    );

    steps.begin("run the tests");
    runStep("tests", "npm", ["test"], {cwd: ROOT, hint: "The failing test is named above. Nothing has been published."});

    steps.begin("check the staged packages are current");
    for (const args of CHECKS) {
        runStep("staleness check", "node", args, {cwd: ROOT, hint: CHECK_HINT});
    }

    steps.begin("publish to npm");
    for (const {dir} of PACKAGES) {
        const {name, version} = manifestOf(dir);
        if (isPublished(name, version)) {
            console.log(`${name} ${version} is already published`);
            continue;
        }
        // Scoped packages publish privately unless told otherwise, which fails every install but yours.
        runStep(`publish ${name} ${version}`, "npm", ["publish", "--access", "public"], {
            cwd: join(ROOT, "packages", dir),
            hint: PUBLISH_HINT,
        });
        console.log(`published ${name} ${version}`);
    }

    const tag = `v${GAME_VERSION}`;
    if (capture("git", ["tag", "--list", tag]).stdout === "") {
        runStep(`tag ${tag}`, "git", ["tag", tag], {cwd: ROOT});
        console.log(`tagged ${tag} — push it with \`git push all ${tag}\``);
    }
}

try {
    main();
}
catch (error) {
    fail("release", error);
}
