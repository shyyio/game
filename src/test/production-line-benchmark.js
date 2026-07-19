// Production-line tick benchmark (Node-only).
//
// Run through the test loader (the `@/` alias is resolved there):
//
//   node --import ./src/test/test-loader.js src/test/production-line-benchmark.js [lineCount] [ticks]
//   npm run bench:lines -- [lineCount] [ticks] [--profile] [--jammed]
//
// Add --expose-gc (node flag, before --import) for collected heap readings.
//
// With --profile it captures two separate V8 CPU profiles - one over the seed (world build), one
// over the tick loop - as profiles/lines-<lines>x<ticks>-{seed,tick}.cpuprofile, for Chrome
// DevTools / VS Code.
//
// Stamps out identical production lines - extractor on a water resource, a 4-belt path, a furnace,
// a 1-belt path, then two chained furnaces, plus a road+housing labor network manning all three
// furnaces - and reports which tick phase costs the most.
//
// Each line's last furnace has no consumer, so left alone every line backs up within ~150 ticks and
// the world becomes a saturated deadlock: intents still submitted, none resolvable. That is a real
// scenario but it is not throughput, so by default the run drains each line's final out-port every
// tick and the lines flow. Pass --jammed for the deadlocked world instead. Either way the report
// prints intents/resolved per tick, so a stalled run is visible rather than silent.

import {makeGameEngine} from "@/test/ecsSim.js";
import {TickPhase, TICK_PHASE_ORDER, EMPTY} from "@/common/sim/GameEngine.js";
import {beltsOf} from "@/mods/Logistics/testHelpers.js";
import {ExtractorType} from "@/mods/Resources/declaration.js";
import {DemoMachineType} from "@/mods/Demo/declaration.js";
import {buildLine, lineOrigin, lineSinkPort} from "@/test/productionLine.js";
import {CpuProfiler, printProfileSummary, printHeapUsage} from "@/test/profiler.js";

const DEFAULT_LINE_COUNT = 5_000;
// High enough that the measurement is not dominated by JIT warmup; below ~500 the phase split still
// moves several percent run to run.
const DEFAULT_TICKS = 1_000;
const TOP_FUNCTIONS = 25;

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
    const jammed = args.includes("--jammed");
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
    const sinkPorts = [];
    for (let k = 0; k < lineCount; k += 1) {
        const origin = lineOrigin(k);
        buildLine(engine, origin.x, origin.y);
        sinkPorts.push(lineSinkPort(engine, origin.x, origin.y));
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
    printHeapUsage("After build");

    const phaseTotals = {};
    for (const phase of TICK_PHASE_ORDER) {
        phaseTotals[phase] = 0;
    }

    if (profiling) {
        await profiler.start();
    }

    console.log(`Running ${ticks.toLocaleString()} ticks${jammed ? " (jammed: no consumer)" : ""}...`);
    let intents = 0;
    let resolved = 0;
    const runStart = performance.now();
    for (let i = 0; i < ticks; i += 1) {
        for (const phase of TICK_PHASE_ORDER) {
            const phaseStart = performance.now();
            engine.tick(phase);
            phaseTotals[phase] += performance.now() - phaseStart;
        }
        intents += engine.intentCount;
        resolved += engine.resolvedCount;
        if (!jammed) {
            // Consume each line's output, so the lines keep flowing instead of backing up.
            for (const port of sinkPorts) {
                if (engine.portItem(port) !== EMPTY) {
                    engine.setPortItem(port, EMPTY);
                }
            }
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
        + `${paths.toLocaleString()} belt paths on the last tick.`
    );
    const resolvedShare = intents === 0 ? 0 : (resolved / intents) * 100;
    console.log(
        `Flow: ${Math.round(intents / ticks).toLocaleString()} intents/tick, `
        + `${Math.round(resolved / ticks).toLocaleString()} resolved (${resolvedShare.toFixed(1)}%).`
    );
    printHeapUsage("After ticks");
    console.log("");

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
