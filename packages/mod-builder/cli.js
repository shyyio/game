#!/usr/bin/env node
// The mod toolchain, as a mod author (and the registry's CI) uses it:
//
//   spup-mod-builder build <mod dir> <out dir> --version 1.0.0 [--title "My Mod"] [--homepage https://...]
//   spup-mod-builder check <package dir>
//   spup-mod-builder scan  <mod.js>
//
// `build` produces the package; `check` is what a listing has to pass. Both run with no game
// checkout in sight — a mod reaches the engine only through the SDK, which the build leaves as an
// external and the check stubs out.

import {existsSync, readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {basename, dirname, join, relative, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {buildMod} from "./dist/build-mod.js";
import {scanBundle} from "./dist/mod-scan.js";
import {ModManifest, SDK_VERSION} from "./dist/ModManifest.js";
import {VERDICT_PREFIX} from "./evalCheck.js";

const USAGE = [
    "usage:",
    "  spup-mod-builder build [mod dir] [out dir] [--version <x.y.z>] [--title <name>] [--homepage <url>] [--minify false]",
    "  spup-mod-builder check [package dir]",
    "  spup-mod-builder scan [mod.js]",
    "",
    "The mod is the working directory and it builds into ./dist, unless said otherwise; the version",
    "comes from the mod's package.json.",
].join("\n");

const OUT_DIR_NAME = "dist";
const BUNDLE_NAME = "mod.js";
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

const HERE = dirname(fileURLToPath(import.meta.url));
const EVAL_SCRIPT = join(HERE, "evalCheck.js");
// The permission model was experimental through node 22 and stable from 23.
const STABLE_PERMISSION_MAJOR = 23;
// Enough of the child's stderr to recognise a crash by, without pasting a whole stack into a report.
const STDERR_SHOWN = 400;

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
 * @param {string[]} positional
 * @param {number} index
 * @param {string} fallback
 * @returns {string}
 */
function positionalOr(positional, index, fallback) {
    if (positional[index] === undefined) {
        return fallback;
    }
    return positional[index];
}

/**
 * The version to build as: what the mod's own package.json says, which is the one place a mod
 * already records it.
 * @param {string} modDir
 * @returns {string}
 */
function versionOf(modDir) {
    const path = join(modDir, "package.json");
    if (!existsSync(path)) {
        throw new Error(`${modDir} has no package.json to take a version from; pass --version`);
    }
    const {version} = JSON.parse(readFileSync(path, "utf8"));
    if (typeof version !== "string" || !VERSION_PATTERN.test(version)) {
        throw new Error(`${path} has no x.y.z version; pass --version`);
    }
    return version;
}

/**
 * @returns {string} the flag that turns this node's permission model on
 */
function permissionFlag() {
    const major = Number(process.versions.node.split(".")[0]);
    if (major >= STABLE_PERMISSION_MAJOR) {
        return "--permission";
    }
    return "--experimental-permission";
}

/**
 * Runs the bundle's factories in a process with no capabilities beyond reading the package, and
 * reads its verdict back.
 * @param {string} dir the package directory
 * @param {string} bundlePath
 * @param {string[]} parts the parts the manifest declares
 * @returns {string[]} problems, empty when clean
 */
function evaluateSandboxed(dir, bundlePath, parts) {
    const child = spawnSync(process.execPath, [
        permissionFlag(),
        "--no-warnings",
        `--allow-fs-read=${HERE}`,
        `--allow-fs-read=${dir}`,
        EVAL_SCRIPT,
        bundlePath,
        ...parts,
    ], {encoding: "utf8"});
    const verdicts = child.stdout.split("\n").filter(line => line.startsWith(VERDICT_PREFIX));
    if (verdicts.length === 0) {
        const stderr = child.stderr.trim().slice(-STDERR_SHOWN);
        return [`${basename(bundlePath)} did not survive evaluation: ${stderr}`];
    }
    return JSON.parse(verdicts[verdicts.length - 1].slice(VERDICT_PREFIX.length));
}

/**
 * Everything a listing must pass: the manifest parses, the bundle reaches no forbidden global, and
 * the factories evaluate against a stub SDK.
 * @param {string} dir a built package directory
 * @returns {Promise<string[]>} problems, empty when clean
 */
export async function checkPackage(dir) {
    const problems = [];
    const manifestPath = join(dir, "mod.json");
    if (!existsSync(manifestPath)) {
        return [`${manifestPath} is missing`];
    }
    let manifest;
    try {
        manifest = ModManifest.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
    } catch (error) {
        return [`mod.json: ${error.message}`];
    }
    if (manifest.sdkVersion !== SDK_VERSION) {
        problems.push(`built for SDK version ${manifest.sdkVersion}, checked against ${SDK_VERSION}`);
    }
    const bundlePath = join(dir, manifest.entry);
    if (!existsSync(bundlePath)) {
        return [...problems, `${manifest.entry} is declared in the manifest but missing from the package`];
    }
    const reached = scanBundle(bundlePath);
    if (reached.length > 0) {
        // A bundle that failed the scan is never evaluated, sandbox or no sandbox: there is nothing
        // left to learn from running code that already declared its intent.
        return [...problems, `${manifest.entry} reaches disallowed globals: ${reached.join(", ")}`];
    }
    return [...problems, ...evaluateSandboxed(dir, bundlePath, manifest.parts)];
}

const [verb, ...rest] = process.argv.slice(2);
const positional = [];
while (rest.length > 0 && !rest[0].startsWith("--")) {
    positional.push(rest.shift());
}
const flags = parseFlags(rest);

if (verb === "build") {
    const modDir = resolve(positionalOr(positional, 0, process.cwd()));
    let outDir = join(modDir, OUT_DIR_NAME);
    if (positional[1] !== undefined) {
        outDir = resolve(positional[1]);
    }
    let version = flags.get("version");
    if (version === undefined) {
        version = versionOf(modDir);
    }
    const manifest = await buildMod(modDir, outDir, {
        version,
        title: flags.get("title"),
        homepage: flags.get("homepage"),
        minify: flags.get("minify") !== "false",
    });
    console.log(`${manifest.displayName} (${manifest.name}) ${manifest.version} (sdk ${manifest.sdkVersion}) -> ${relative(process.cwd(), outDir)}`);
} else if (verb === "check") {
    const dir = resolve(positionalOr(positional, 0, join(process.cwd(), OUT_DIR_NAME)));
    const problems = await checkPackage(dir);
    for (const problem of problems) {
        console.error(`  ${problem}`);
    }
    if (problems.length > 0) {
        console.error(`${dir}: ${problems.length} problem(s)`);
        process.exitCode = 1;
    } else {
        console.log(`${dir}: all checks passed`);
    }
} else if (verb === "scan") {
    const bundle = resolve(positionalOr(positional, 0, join(process.cwd(), OUT_DIR_NAME, BUNDLE_NAME)));
    const reached = scanBundle(bundle);
    if (reached.length > 0) {
        console.error(`${bundle} reaches disallowed globals: ${reached.join(", ")}`);
        process.exitCode = 1;
    } else {
        console.log(`${bundle}: clean`);
    }
} else {
    console.error(USAGE);
    process.exitCode = 1;
}
