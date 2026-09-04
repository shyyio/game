import {existsSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {ModLockfile} from "@/common/ModLockfile.js";
import {resolvePackage} from "@/server/ModCache.js";

const ORDER_FILE = "order.json";

/**
 * Pins the base mods a build ships, read in the order its order.json lists them.
 * @param {string} distMods the built packages' directory
 * @returns {Promise<ModLockfile|null>} null when nothing is built there
 */
export async function pinBuiltMods(distMods) {
    const orderPath = join(distMods, ORDER_FILE);
    if (!existsSync(orderPath)) {
        return null;
    }
    const order = JSON.parse(readFileSync(orderPath, "utf8"));
    const entries = [];
    for (const dir of order) {
        entries.push(await resolvePackage(`${pathToFileURL(join(distMods, dir)).href}/`));
    }
    return new ModLockfile(entries);
}
