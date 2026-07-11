// Production-line tick benchmark (Node-only).
//
// Run through the test loader (DEV/profiling on, `@/` alias resolved):
//
//   node --import ./src/test/test-loader.js src/test/production-line-benchmark.js [lineCount] [ticks]
//   npm run bench:lines -- [lineCount] [ticks]
//
// Stamps out a huge number of identical production lines — extractor on a water
// resource -> 4-belt path -> furnace -> 1-belt path -> two chained furnaces — then
// runs whole ticks and reports which tick-phase SQL ops cost the most. Every line
// is perpetually active (its extractor keeps producing), so unlike the idle-belt
// benchmark this stresses the machine/extractor tick ops, not just belt movement.

import {setupGame} from "@/sdk/test.js";
import {LogisticsMod} from "@/mods/Logistics/mod.js";
import {DemoMod, DemoMachineDefinition} from "@/mods/DemoMod/DemoMod.js";
import {ResourcesMod, WaterResourceDefinition, ExtractorDefinition} from "@/mods/Resources/Resources.js";
import {CreateObjectMessage, Direction} from "@/sdk/common.js";
import {CreateBeltMessage} from "@/mods/Logistics/messages.js";
import {printReport, intArg} from "@/test/belt-benchmark-common.js";

const DEFAULT_LINE_COUNT = 5_000;
const DEFAULT_TICKS = 50;

const BELT_NORMAL = 0;
// One line spans 9 tiles in x (extractor at 0, belts 1..4, machines/belt 5..8) and
// one tile in y; lines tile on a grid with a spare column/row between them so no two
// lines ever share a port.
const LINE_WIDTH = 9;
const CELL_WIDTH = LINE_WIDTH + 1;
const ROW_STRIDE = 2;
const LINES_PER_BAND = 64;
const BASE_X = 8;
const BASE_Y = 8;

/**
 * Stamps one production line at (ox, oy), running rightward, exactly as a client
 * would place it: water resource, extractor on it, a 4-belt path, a furnace, a
 * 1-belt path, then two chained furnaces.
 * @param {TestHarness} game
 * @param {number} ox
 * @param {number} oy
 */
function buildLine(game, ox, oy) {
    const dir = Direction.RIGHT;
    game.dispatchMessage(new CreateObjectMessage(WaterResourceDefinition.typeId, ox, oy, dir));
    game.dispatchMessage(new CreateObjectMessage(ExtractorDefinition.typeId, ox, oy, dir));
    for (let i = 1; i <= 4; i += 1) {
        game.dispatchMessage(new CreateBeltMessage(ox + i, oy, dir, BELT_NORMAL));
    }
    game.dispatchMessage(new CreateObjectMessage(DemoMachineDefinition.typeId, ox + 5, oy, dir));
    game.dispatchMessage(new CreateBeltMessage(ox + 6, oy, dir, BELT_NORMAL));
    game.dispatchMessage(new CreateObjectMessage(DemoMachineDefinition.typeId, ox + 7, oy, dir));
    game.dispatchMessage(new CreateObjectMessage(DemoMachineDefinition.typeId, ox + 8, oy, dir));
}

async function main() {
    const lineCount = intArg(process.argv[2], DEFAULT_LINE_COUNT);
    const ticks = intArg(process.argv[3], DEFAULT_TICKS);

    const game = await setupGame([new LogisticsMod(), new DemoMod(), new ResourcesMod()]);

    console.log(`Building ${lineCount.toLocaleString()} production lines...`);
    const seedStart = performance.now();
    for (let k = 0; k < lineCount; k += 1) {
        const col = k % LINES_PER_BAND;
        const row = Math.floor(k / LINES_PER_BAND);
        buildLine(game, BASE_X + col * CELL_WIDTH, BASE_Y + row * ROW_STRIDE);
    }
    const seedMs = performance.now() - seedStart;

    const machines = game.rawScalar("SELECT COUNT(*) FROM DemoMachine");
    const belts = game.rawScalar("SELECT COUNT(*) FROM Belt");
    console.log(
        `Built in ${(seedMs / 1000).toFixed(1)}s: `
        + `${lineCount.toLocaleString()} extractors, ${machines.toLocaleString()} machines, ${belts.toLocaleString()} belts.`
    );

    // Profile only the tick loop: discard everything the seeding did, then measure
    // from the first tick after the world is built.
    game.db.resetProfiling();

    console.log(`Running ${ticks.toLocaleString()} ticks...`);
    const runStart = performance.now();
    for (let i = 0; i < ticks; i += 1) {
        game.tickAll();
    }
    const runMs = performance.now() - runStart;

    const activePaths = game.rawScalar("SELECT COUNT(*) FROM ActivePath");
    console.log(
        `Measured: ${(runMs / 1000).toFixed(2)}s over ${ticks} ticks `
        + `(${(runMs / Math.max(ticks, 1)).toFixed(1)}ms/tick); `
        + `${activePaths.toLocaleString()} active paths on the last tick.\n`
    );

    printReport(game.db.profilingSummary());
}

main();
