// The resolve/load hooks behind test-loader.js. Kept separate because node runs a loader's hooks in
// their own thread, off a module it registers by path.

import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

const SDK_SPECIFIERS = ["@/sdk/common.js", "@/sdk/client.js"];
const SDK_URL = new URL("./sdkFakeModule.js", import.meta.url).href;

/**
 * @param {string} specifier
 * @param {object} context
 * @param {Function} nextResolve
 * @returns {object}
 */
export function resolve(specifier, context, nextResolve) {
    if (SDK_SPECIFIERS.includes(specifier)) {
        return {url: SDK_URL, format: "module", shortCircuit: true};
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
