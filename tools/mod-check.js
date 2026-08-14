// The automated checks a built package must pass before it is published: manifest sanity, the
// free-variable scan, and a load test that registers the declaration and sim parts into a throwaway
// ModRegistry and freezes it. The client part is scanned but never evaluated — pixi does not run
// headless, and a mod's client code is trust-by-distribution either way (see docs).
//
//   node tools/mod-check.js <package dir>

import {existsSync, readFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {ModManifest, SDK_VERSION, MOD_PART_SIM, MOD_PART_CLIENT} from "../src/common/ModManifest.js";
import {ModPackage} from "../src/common/ModPackage.js";
import {ModRegistry} from "../src/common/ModRegistry.js";
import {scanBundle} from "./mod-scan.js";
import * as sdk from "../src/sdk/common.js";

/**
 * Runs every publishable-package check.
 * @param {string} dir a built package directory (mod.json + mod.js + assets)
 * @returns {Promise<{manifest: ModManifest|null, problems: string[]}>}
 */
export async function checkPackage(dir) {
    const problems = [];
    const manifestPath = join(dir, "mod.json");
    if (!existsSync(manifestPath)) {
        return {manifest: null, problems: [`${manifestPath} is missing`]};
    }
    let manifest;
    try {
        manifest = ModManifest.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
    } catch (error) {
        return {manifest: null, problems: [`mod.json: ${error.message}`]};
    }
    if (manifest.sdkVersion !== SDK_VERSION) {
        problems.push(`built for SDK version ${manifest.sdkVersion}, checked against ${SDK_VERSION}`);
    }
    for (const file of manifest.files) {
        if (!existsSync(join(dir, file))) {
            problems.push(`${file} is declared in the manifest but missing from the package`);
        }
    }
    if (problems.length > 0) {
        return {manifest, problems};
    }

    const bundlePath = join(dir, manifest.entry);
    const reached = scanBundle(bundlePath);
    if (reached.length > 0) {
        problems.push(`${manifest.entry} reaches disallowed globals: ${reached.join(", ")}`);
    }

    let bundle;
    try {
        bundle = await import(pathToFileURL(bundlePath).href);
    } catch (error) {
        problems.push(`${manifest.entry} could not be imported: ${error.message}`);
        return {manifest, problems};
    }
    for (const [part, factory] of [["declaration", "createDeclaration"], [MOD_PART_SIM, "createSim"], [MOD_PART_CLIENT, "createClient"]]) {
        const declared = manifest.has(part);
        if (declared !== (typeof bundle[factory] === "function")) {
            problems.push(`the manifest ${declared ? "declares" : "omits"} the ${part} part, but the bundle ${declared ? "exports no" : "exports a"} ${factory}`);
        }
    }
    if (problems.length > 0) {
        return {manifest, problems};
    }

    try {
        const declaration = bundle.createDeclaration(sdk);
        const sim = manifest.has(MOD_PART_SIM) ? bundle.createSim(sdk) : null;
        const registry = new ModRegistry();
        registry.register(new ModPackage(declaration, {sim}));
        registry.freeze();
        if (typeof declaration.name !== "string" || declaration.name.length === 0) {
            problems.push("the declaration has no name");
        }
    } catch (error) {
        problems.push(`load test failed: ${error.message}`);
    }
    return {manifest, problems};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const [target] = process.argv.slice(2);
    if (target === undefined) {
        throw new Error("usage: mod-check.js <package dir>");
    }
    const {manifest, problems} = await checkPackage(resolve(target));
    if (problems.length === 0) {
        console.log(`${manifest.name} ${manifest.version}: all checks passed`);
    } else {
        for (const problem of problems) {
            console.error(`  ${problem}`);
        }
        console.error(`${target}: ${problems.length} problem(s)`);
        process.exitCode = 1;
    }
}
