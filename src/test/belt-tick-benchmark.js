// Belt tick benchmark (Node-only).
//
// Run through the test loader (DEV/profiling on, `@/` alias resolved):
//
//   node --import ./src/test/test-loader.js src/test/belt-tick-benchmark.js [seedCount] [ticks]
//   npm run bench:tick -- [seedCount] [ticks]
//
// Where the create/delete benchmark drives editing, this drives the simulation:
// it seeds a large world, then runs whole ticks and reports which tick-phase SQL
// ops cost the most. The seed's out-ports are pre-filled so items stay resident
// (a saturated, steady state), which keeps every tick doing the same full-world
// work — the global RecalculateNextGap/RecalculateNextItem scans included.

import {setup} from "@/test/common.js";
import {seedDatabase, printReport, intArg, MAX_SEED_COUNT} from "@/test/belt-benchmark-common.js";

const DEFAULT_SEED_COUNT = 10_000_000;
const DEFAULT_TICKS = 20;

async function main() {
    const seedCount = Math.min(intArg(process.argv[2], DEFAULT_SEED_COUNT), MAX_SEED_COUNT);
    const ticks = intArg(process.argv[3], DEFAULT_TICKS);

    const game = await setup();

    console.log(`Seeding ${seedCount.toLocaleString()} belts (+paths, +items)...`);
    const seedStart = performance.now();
    seedDatabase(game.db, seedCount);

    // Block every out-port so nothing drains: items stay on their belts and each
    // tick re-scans the same full world (a saturated steady state).
    game.db.rawExec("UPDATE Port SET item = 1 WHERE id IN (SELECT out_port_id FROM BeltPath)");
    const seedMs = performance.now() - seedStart;

    const beltCount = game.rawScalar("SELECT COUNT(*) FROM Belt");
    console.log(`Seeded in ${(seedMs / 1000).toFixed(1)}s: ${beltCount.toLocaleString()} belts.`);

    // One warm-up tick to settle next_gap_id/next_item_id, so the measured ticks
    // are all steady-state and comparable.
    game.tickAll();
    game.db.resetProfiling();

    console.log(`Running ${ticks.toLocaleString()} ticks...`);
    const runStart = performance.now();
    for (let i = 0; i < ticks; i += 1) {
        game.tickAll();
    }
    const runMs = performance.now() - runStart;

    console.log(
        `Measured: ${(runMs / 1000).toFixed(2)}s over ${ticks} ticks `
        + `(${(runMs / Math.max(ticks, 1)).toFixed(1)}ms/tick).\n`
    );

    printReport(game.db.profilingSummary());
}

main();
