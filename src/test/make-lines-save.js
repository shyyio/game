import {EMPTY} from "@/common/sim/GameEngine.js";
import {NodeSaveStore} from "@/server/NodeSaveStore.js";
import {makeGameEngine} from "@/test/ecsSim.js";
import {buildLine, lineOrigin, lineSinkPort} from "@/test/productionLine.js";
import {printHeapUsage} from "@/test/profiler.js";

// Writes a NodeSaveStore SQLite save holding the bench:lines world, so the scenario can be loaded
// instead of rebuilt. Usage:
//
//   npm run save:lines -- [path] [lineCount] [warmupTicks]
//
// Warmup ticks run with the sinks drained, matching the benchmark's default flowing world, so the
// save captures lines mid-flow rather than empty.
const DEFAULT_PATH = "LINES.sqlite3";
const DEFAULT_LINE_COUNT = 5_000;
const DEFAULT_WARMUP_TICKS = 200;

const MS_PER_SECOND = 1000;

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

async function main() {
    const args = process.argv.slice(2);
    const path = args[0] === undefined ? DEFAULT_PATH : args[0];
    const lineCount = intArg(args[1], DEFAULT_LINE_COUNT);
    const warmupTicks = intArg(args[2], DEFAULT_WARMUP_TICKS);

    const engine = await makeGameEngine();

    console.log(`Building ${lineCount.toLocaleString()} production lines...`);
    const buildStart = performance.now();
    const sinkPorts = [];
    for (let k = 0; k < lineCount; k += 1) {
        const origin = lineOrigin(k);
        buildLine(engine, origin.x, origin.y);
        sinkPorts.push(lineSinkPort(engine, origin.x, origin.y));
    }
    const buildMs = performance.now() - buildStart;
    console.log(`Built in ${(buildMs / MS_PER_SECOND).toFixed(1)}s.`);

    console.log(`Warming up ${warmupTicks.toLocaleString()} ticks...`);
    for (let i = 0; i < warmupTicks; i += 1) {
        engine.tickAll();
        for (const port of sinkPorts) {
            if (engine.portItem(port) !== EMPTY) {
                engine.setPortItem(port, EMPTY);
            }
        }
    }

    printHeapUsage("After warmup");

    const store = new NodeSaveStore(path);
    await store.save(engine.serialize());
    console.log(`wrote lines save: ${path}`);
}

await main();
