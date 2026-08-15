#!/usr/bin/env node
// Loads a built bundle and runs its factories against a stub SDK, in a process that can do nothing
// else: node's permission model grants read access to the package and nothing more.
//
//   node --experimental-permission --allow-fs-read=<dir> evalCheck.js <bundle> <part>...
//
// The scan cannot make this safe on its own — `[].constructor.constructor` is the Function
// constructor, and no free name gives it away — so what contains a hostile bundle is the process,
// not the lint. Everything that needs the bundle loaded happens here for that reason.
//
// The verdict is the last marked line on stdout; the rest of stdout belongs to the bundle.

import {basename} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {MOD_PART_DECLARATION, MOD_PART_SIM, MOD_PART_CLIENT} from "./dist/ModManifest.js";
import {stubSdk} from "./dist/stubSdk.js";

export const VERDICT_PREFIX = "@spup/mod-builder:verdict:";

// The factory each part is exported as.
const PART_FACTORIES = [
    [MOD_PART_DECLARATION, "createDeclaration"],
    [MOD_PART_SIM, "createSim"],
    [MOD_PART_CLIENT, "createClient"],
];

// The client part is deliberately not called: it wants a live renderer, which no check has.
const EVALUATED_PARTS = [MOD_PART_DECLARATION, MOD_PART_SIM];

/**
 * Imports a bundle, matches its exports against the declared parts, and runs the factories.
 * @param {string} bundlePath
 * @param {string[]} parts the parts the manifest declares
 * @returns {Promise<string[]>} problems, empty when clean
 */
export async function evaluateBundle(bundlePath, parts) {
    const name = basename(bundlePath);
    let bundle;
    try {
        bundle = await import(pathToFileURL(bundlePath).href);
    } catch (error) {
        return [`${name} could not be imported: ${error.message}`];
    }
    const problems = [];
    for (const [part, factory] of PART_FACTORIES) {
        const declared = parts.includes(part);
        const exported = typeof bundle[factory] === "function";
        if (declared && !exported) {
            problems.push(`the manifest declares the ${part} part, but the bundle exports no ${factory}`);
        } else if (!declared && exported) {
            problems.push(`the manifest omits the ${part} part, but the bundle exports a ${factory}`);
        }
    }
    if (problems.length > 0) {
        return problems;
    }
    for (const [part, factory] of PART_FACTORIES) {
        if (!parts.includes(part) || !EVALUATED_PARTS.includes(part)) {
            continue;
        }
        try {
            bundle[factory](stubSdk());
        } catch (error) {
            problems.push(`${factory} threw against a stub SDK: ${error.message}`);
        }
    }
    return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const [bundlePath, ...parts] = process.argv.slice(2);
    const problems = await evaluateBundle(bundlePath, parts);
    console.log(`${VERDICT_PREFIX}${JSON.stringify(problems)}`);
}
