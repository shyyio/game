import {fileURLToPath, URL} from "node:url";

const srcRoot = new URL("../", import.meta.url);

export function resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
        const resolved = new URL(specifier.slice(2), srcRoot);
        return nextResolve(fileURLToPath(resolved), context);
    }
    return nextResolve(specifier, context);
}
