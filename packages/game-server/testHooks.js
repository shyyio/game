// The resolve/load hooks behind test-loader.js. Kept separate because node runs a loader's hooks in
// their own thread, off a module it registers by path.

import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

const SDK_COMMON = "@spup/sdk";
const SDK_CLIENT = "@spup/sdk/client";
const HARNESS_URL = new URL("./dist-harness/harness.js", import.meta.url).href;

/**
 * @param {string} specifier
 * @param {object} context
 * @param {Function} nextResolve
 * @returns {object}
 */
export function resolve(specifier, context, nextResolve) {
    // The engine under test, not the copy in node_modules: a mod's classes and the game's have to
    // be the same ones for `instanceof` to hold.
    if (specifier === SDK_COMMON) {
        return {url: HARNESS_URL, format: "module", shortCircuit: true};
    }
    if (specifier === SDK_CLIENT) {
        // Rendering needs a browser: pixi does not run under node, so a client part cannot be
        // imported here. Test the sim and the declaration; the client part is for playing.
        throw new Error(`${specifier} cannot be imported in a test: the client SDK needs a browser`);
    }
    return nextResolve(specifier, context);
}

/**
 * Asset imports mean what the builder makes them mean: an image is its own path, frame data is
 * parsed JSON.
 * @param {string} url
 * @param {object} context
 * @param {Function} nextLoad
 * @returns {object}
 */
export function load(url, context, nextLoad) {
    if (/\.(png|jpg|jpeg|webp)$/.test(url)) {
        return {format: "module", source: `export default ${JSON.stringify(fileURLToPath(url))};`, shortCircuit: true};
    }
    if (url.endsWith(".json") && !url.includes("/node_modules/")) {
        return {format: "module", source: `export default ${readFileSync(new URL(url), "utf8")};`, shortCircuit: true};
    }
    return nextLoad(url, context);
}
