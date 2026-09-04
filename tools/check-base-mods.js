// Packages every base mod the way the registry does and runs the publish checks over each one, so a
// mod that could not be published breaks here rather than in the registry's CI, a deploy later.
//
//   node tools/check-base-mods.js
//
// `npm run deploy` runs this in its pre-flight. The packages go to a temp directory and are thrown
// away: nothing here publishes, and `npm run mods:base` is still what builds a servable loadout.

import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve, dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {buildMod, packageName} from "./build-mod.js";
import {checkPackage} from "./mod-check.js";
import {GAME_VERSION} from "../src/common/constants.js";
import {BASE_MOD_DIRS} from "../src/mods/loadout.js";
import {StepError, fail} from "./steps.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const HINT = [
    "That mod cannot be published as a package, so the registry's CI would refuse it too. A bundler",
    "error is printed above; a disallowed global is usually a browser API the mod names directly",
    "rather than reaching through the SDK.",
].join("\n");

/**
 * Builds and checks the whole loadout.
 * @returns {Promise<void>}
 */
export async function checkBaseMods() {
    const scratch = mkdtempSync(join(tmpdir(), "spup-base-mods-"));
    const failures = [];
    try {
        for (const dir of BASE_MOD_DIRS) {
            const name = packageName(dir);
            const packageDir = join(scratch, dir);
            let problems;
            try {
                await buildMod(join(ROOT, "src/mods", dir), packageDir, {version: GAME_VERSION});
                ({problems} = await checkPackage(packageDir));
            }
            catch (error) {
                // A mod that will not even bundle is the same failure to a publisher as one that
                // bundles into something the scan refuses.
                problems = [`could not be packaged: ${error.message}`];
            }
            if (problems.length === 0) {
                console.log(`  ${name}: all checks passed`);
                continue;
            }
            for (const problem of problems) {
                console.error(`  ${name}: ${problem}`);
            }
            failures.push(name);
        }
    }
    finally {
        rmSync(scratch, {recursive: true, force: true});
    }
    if (failures.length > 0) {
        throw new StepError(`these base mods do not pass their publish checks: ${failures.join(", ")}`, HINT);
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        await checkBaseMods();
    }
    catch (error) {
        fail("check:mods", error);
    }
}
