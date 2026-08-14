#!/usr/bin/env node
// The mod toolchain, as a mod author (and the registry's CI) uses it:
//
//   spup-mod-builder build <mod dir> <out dir> --version 1.0.0 [--homepage https://...]
//   spup-mod-builder check <package dir>
//   spup-mod-builder scan  <mod.js>
//
// `build` produces the package; `check` is what a listing has to pass. Both run with no game
// checkout in sight — a mod reaches the engine only through the SDK, which the build leaves as an
// external and the check stubs out.

import {existsSync, readFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {buildMod} from "./lib/build-mod.js";
import {scanBundle} from "./lib/mod-scan.js";
import {ModManifest, SDK_VERSION, MOD_PART_SIM, MOD_PART_CLIENT} from "./lib/ModManifest.js";
import {stubSdk} from "./lib/stubSdk.js";

const USAGE = [
    "usage:",
    "  spup-mod-builder build <mod dir> <out dir> --version <x.y.z> [--homepage <url>]",
    "  spup-mod-builder check <package dir>",
    "  spup-mod-builder scan <mod.js>",
].join("\n");

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
        problems.push(`${manifest.entry} reaches disallowed globals: ${reached.join(", ")}`);
    }

    let bundle;
    try {
        bundle = await import(pathToFileURL(bundlePath).href);
    } catch (error) {
        return [...problems, `${manifest.entry} could not be imported: ${error.message}`];
    }
    for (const [part, factory] of [["declaration", "createDeclaration"], [MOD_PART_SIM, "createSim"], [MOD_PART_CLIENT, "createClient"]]) {
        const declared = manifest.has(part);
        if (declared !== (typeof bundle[factory] === "function")) {
            problems.push(`the manifest ${declared ? "declares" : "omits"} the ${part} part, but the bundle ${declared ? "exports no" : "exports a"} ${factory}`);
        }
    }
    if (problems.length > 0) {
        return problems;
    }
    // The client part is deliberately not called: it wants a live renderer, which no check has.
    for (const factory of ["createDeclaration", ...(manifest.has(MOD_PART_SIM) ? ["createSim"] : [])]) {
        try {
            bundle[factory](stubSdk());
        } catch (error) {
            problems.push(`${factory} threw against a stub SDK: ${error.message}`);
        }
    }
    return problems;
}

const [verb, ...rest] = process.argv.slice(2);
if (verb === "build") {
    const [modDir, outDir, ...flagArgs] = rest;
    const flags = parseFlags(flagArgs);
    if (modDir === undefined || outDir === undefined || flags.get("version") === undefined) {
        throw new Error(USAGE);
    }
    const manifest = await buildMod(resolve(modDir), resolve(outDir), {
        version: flags.get("version"),
        homepage: flags.get("homepage"),
    });
    console.log(`${manifest.name} ${manifest.version} (sdk ${manifest.sdkVersion}) -> ${outDir}`);
} else if (verb === "check") {
    const [dir] = rest;
    if (dir === undefined) {
        throw new Error(USAGE);
    }
    const problems = await checkPackage(resolve(dir));
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
    const [bundle] = rest;
    if (bundle === undefined) {
        throw new Error(USAGE);
    }
    const reached = scanBundle(resolve(bundle));
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
