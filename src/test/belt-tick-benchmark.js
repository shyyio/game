// Belt tick benchmark (Node-only).
//
// Run through the test loader (DEV/profiling on, `@/` alias resolved):
//
//   node --import ./src/test/test-loader.js src/test/belt-tick-benchmark.js [seedCount] [ticks] [itemCount]
//   npm run bench:tick -- [seedCount] [ticks] [itemCount]
//
// Drives the simulation: seeds a large world, then runs whole ticks and reports
// which tick-phase SQL ops cost the most. Only `itemCount` of the belts carry an
// item; the rest are
// idle — modeling a realistic large map where most belts sit empty. A tick
// should cost in proportion to the active belts, not the whole world.

import {setup} from "@/test/common.js";
import {seedDatabase, printReport, intArg, MAX_SEED_COUNT} from "@/test/belt-benchmark-common.js";

const DEFAULT_SEED_COUNT = 100_000;
const DEFAULT_TICKS = 50;
const DEFAULT_ITEM_COUNT = 50_000;

async function main() {
    const seedCount = Math.min(intArg(process.argv[2], DEFAULT_SEED_COUNT), MAX_SEED_COUNT);
    const ticks = intArg(process.argv[3], DEFAULT_TICKS);
    const itemCount = Math.min(intArg(process.argv[4], DEFAULT_ITEM_COUNT), seedCount);

    const game = await setup();

    console.log(`Seeding ${seedCount.toLocaleString()} belts (${itemCount.toLocaleString()} carrying an item)...`);
    const seedStart = performance.now();
    seedDatabase(game.db, seedCount, itemCount);
    const seedMs = performance.now() - seedStart;

    const beltCount = game.rawScalar("SELECT COUNT(*) FROM Belt");
    console.log(`Seeded in ${(seedMs / 1000).toFixed(1)}s: ${beltCount.toLocaleString()} belts.`);

    // One warm-up tick to settle each item into a steady state (a standalone loaded
    // belt pops its item into its own out-port and then sits idle), so the measured
    // ticks reflect a quiescent large map.
    game.tickAll();
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
