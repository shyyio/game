// Production-line tick benchmark (Node-only).
//
// Run through the test loader (the `@/` alias is resolved there):
//
//   node --import ./src/test/test-loader.js src/test/production-line-benchmark.js [lineCount] [ticks]
//   npm run bench:lines -- [lineCount] [ticks] [--profile]
//
// With --profile it captures two separate V8 CPU profiles - one over the seed (world build), one
// over the tick loop - as profiles/lines-<lines>x<ticks>-{seed,tick}.cpuprofile, for Chrome
// DevTools / VS Code.
//
// Stamps out identical production lines - extractor on a water resource, a 4-belt path, a furnace,
// a 1-belt path, then two chained furnaces - and reports which tick phase costs the most. Every
// line is perpetually active, so this stresses the machine/extractor tick, not just belt movement.

import {makeGameEngine} from "@/test/ecsSim.js";
import {TickPhase, TICK_PHASE_ORDER} from "@/common/sim/GameEngine.js";
import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {Direction} from "@/common/constants.js";
import {CreateBeltMessage} from "@/mods/Logistics/messages.js";
import {beltsOf} from "@/mods/Logistics/testHelpers.js";
import {WaterResourceType, ExtractorType} from "@/mods/Resources/declaration.js";
import {DemoMachineType} from "@/mods/Demo/declaration.js";
import {BELT_NORMAL} from "@/mods/Logistics/constants.js";
import {CpuProfiler, printProfileSummary} from "@/test/profiler.js";

const DEFAULT_LINE_COUNT = 5_000;
const DEFAULT_TICKS = 50;
const TOP_FUNCTIONS = 25;

// One line spans 9 tiles in x (extractor at 0, belts 1..4, machines/belt 5..8) and one tile in y;
// lines tile on a grid with a spare column/row between them so no two lines ever share a port.
const LINE_WIDTH = 9;
const CELL_WIDTH = LINE_WIDTH + 1;
const ROW_STRIDE = 2;
const LINES_PER_BAND = 64;
const BASE_X = 8;
const BASE_Y = 8;

const MS_PER_SECOND = 1000;

const PHASE_NAMES = new Map(Object.entries(TickPhase).map(([name, phase]) => [phase, name]));

/**
 * Parses a positional integer argument, falling back when absent or unparsable.
 * @param {string|undefined} raw
 * @param {number} fallback
 * @returns {number}
 */
function intArg(raw, fallback) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
    }
    return fallback;
}

/**
 * Stamps one production line at (ox, oy) running rightward, exactly as a client would place it.
 * @param {GameEngine} engine
 * @param {number} ox
 * @param {number} oy
 * @returns {void}
 */
function buildLine(engine, ox, oy) {
    const dir = Direction.RIGHT;
    engine.applyMessage(new CreateObjectMessage(WaterResourceType.typeId, ox, oy, dir));
    engine.applyMessage(new CreateObjectMessage(ExtractorType.typeId, ox, oy, dir));
    for (let i = 1; i <= 4; i += 1) {
        engine.applyMessage(new CreateBeltMessage(ox + i, oy, dir, BELT_NORMAL));
    }
    engine.applyMessage(new CreateObjectMessage(DemoMachineType.typeId, ox + 5, oy, dir));
    engine.applyMessage(new CreateBeltMessage(ox + 6, oy, dir, BELT_NORMAL));
    engine.applyMessage(new CreateObjectMessage(DemoMachineType.typeId, ox + 7, oy, dir));
    engine.applyMessage(new CreateObjectMessage(DemoMachineType.typeId, ox + 8, oy, dir));
}

/**
 * Prints per-phase tick cost, most expensive first.
 * @param {Object<number, number>} phaseTotals
 * @param {number} ticks
 * @returns {void}
 */
function printReport(phaseTotals, ticks) {
    const rows = TICK_PHASE_ORDER
        .map(phase => ({name: PHASE_NAMES.get(phase), totalMs: phaseTotals[phase]}))
        .sort((a, b) => b.totalMs - a.totalMs);
    const total = rows.reduce((sum, row) => sum + row.totalMs, 0);

    console.log("Phase                 total ms    ms/tick   share");
    for (const row of rows) {
        const perTick = (row.totalMs / ticks).toFixed(2);
        const share = ((row.totalMs / total) * 100).toFixed(1);
        console.log(
            `${row.name.padEnd(18)} ${row.totalMs.toFixed(1).padStart(10)} `
            + `${perTick.padStart(10)} ${`${share}%`.padStart(7)}`
        );
    }
}

async function main() {
    const args = process.argv.slice(2);
    const positional = args.filter(arg => !arg.startsWith("--"));
    const profiling = args.includes("--profile");
    const lineCount = intArg(positional[0], DEFAULT_LINE_COUNT);
    const ticks = intArg(positional[1], DEFAULT_TICKS);
    const seedProfilePath = `profiles/lines-${lineCount}x${ticks}-seed.cpuprofile`;
    const tickProfilePath = `profiles/lines-${lineCount}x${ticks}-tick.cpuprofile`;

    const engine = await makeGameEngine();
    const profiler = new CpuProfiler();
    if (profiling) {
        console.log("Profiling seed and tick separately (timings below are inflated by sampling overhead).");
    }

    console.log(`Building ${lineCount.toLocaleString()} production lines...`);
    if (profiling) {
        await profiler.start();
    }
    const buildStart = performance.now();
    for (let k = 0; k < lineCount; k += 1) {
        const col = k % LINES_PER_BAND;
        const row = Math.floor(k / LINES_PER_BAND);
        buildLine(engine, BASE_X + col * CELL_WIDTH, BASE_Y + row * ROW_STRIDE);
    }
    const buildMs = performance.now() - buildStart;

    let seedProfile = null;
    if (profiling) {
        seedProfile = await profiler.stop(seedProfilePath);
    }

    const extractors = engine.placed.eidsOf(ExtractorType.typeId).length;
    const machines = engine.placed.eidsOf(DemoMachineType.typeId).length;
    console.log(
        `Built in ${(buildMs / MS_PER_SECOND).toFixed(1)}s: `
        + `${extractors.toLocaleString()} extractors, ${machines.toLocaleString()} machines.`
    );

    const phaseTotals = {};
    for (const phase of TICK_PHASE_ORDER) {
        phaseTotals[phase] = 0;
    }

    if (profiling) {
        await profiler.start();
    }

    console.log(`Running ${ticks.toLocaleString()} ticks...`);
    const runStart = performance.now();
    for (let i = 0; i < ticks; i += 1) {
        for (const phase of TICK_PHASE_ORDER) {
            const phaseStart = performance.now();
            engine.tick(phase);
            phaseTotals[phase] += performance.now() - phaseStart;
        }
    }
    const runMs = performance.now() - runStart;

    let tickProfile = null;
    if (profiling) {
        tickProfile = await profiler.stop(tickProfilePath);
    }

    const paths = beltsOf(engine).paths.length;
    console.log(
        `Measured: ${(runMs / MS_PER_SECOND).toFixed(2)}s over ${ticks} ticks `
        + `(${(runMs / ticks).toFixed(1)}ms/tick); `
        + `${paths.toLocaleString()} belt paths on the last tick.\n`
    );

    printReport(phaseTotals, ticks);

    if (profiling) {
        printProfileSummary(seedProfile, TOP_FUNCTIONS, "Seed");
        printProfileSummary(tickProfile, TOP_FUNCTIONS, "Tick");
        console.log(
            `\nWrote ${seedProfilePath} and ${tickProfilePath}`
            + " - open either in Chrome DevTools (Performance) or VS Code."
        );
    }
}

main();
