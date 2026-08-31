import {fileURLToPath, URL} from "node:url";
import {readFileSync} from "node:fs";

const srcRoot = new URL("../", import.meta.url);
const modsRoot = new URL("../mods/", import.meta.url).href;

// Mods import the engine by its published package name; in this repo that name is the source it is
// packed from, so a mod and the engine share one set of classes.
const SDK_MODULES = new Map([
    ["@spup/sdk", "sdk/common.js"],
    ["@spup/sdk/client", "sdk/client.js"],
]);

export function resolve(specifier, context, nextResolve) {
    const sdkModule = SDK_MODULES.get(specifier);
    if (sdkModule !== undefined) {
        return nextResolve(fileURLToPath(new URL(sdkModule, srcRoot)), context);
    }
    if (specifier.startsWith("@/")) {
        const resolved = new URL(specifier.slice(2), srcRoot);
        return nextResolve(fileURLToPath(resolved), context);
    }
    return nextResolve(specifier, context);
}

// Mirror vite's asset semantics for mod assets only (a .png import resolves to its URL string, a
// .json import to its parsed data), so mod declarations (BaseTextures) load under node.
export function load(url, context, nextLoad) {
    if (url.startsWith(modsRoot)) {
        if (url.endsWith(".png")) {
            return {format: "module", source: `export default ${JSON.stringify(url)};`, shortCircuit: true};
        }
        if (url.endsWith(".json")) {
            return {format: "module", source: `export default ${readFileSync(new URL(url), "utf8")};`, shortCircuit: true};
        }
    }
    return nextLoad(url, context);
}
