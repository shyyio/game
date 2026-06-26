// Belt create/delete benchmark (Node-only).
//
// Run through the test loader so the `@/` alias resolves and DEV is on (which is
// what gates the database's per-statement profiling):
//
//   node --import ./src/test/test-loader.js src/test/belt-benchmark.js [seedCount] [iterations]
//   npm run bench -- [seedCount] [iterations]
//
// Step 1 bulk-seeds a large database directly in SQL (never through the sim's
// create-belt code) purely to make the tables big. Step 2 then drives the real
// create/delete-belt message handlers over an empty region, exercising the
// branches of that code, and reports the collected profiling data.

import {setup} from "@/test/common.js";
import {GameObject, createBelt, deleteBelt} from "@/mods/Belt/testHelpers.js";
import {BELT_NORMAL, BELT_UNDERGROUND} from "@/mods/Belt/constants.js";
import {Direction, CHUNK_SIZE} from "@/common/constants.js";

// Defaults; overridable as CLI args (seedCount, iterations). Each create/delete
// statement touched by a pattern is sampled `iterations` times, which is plenty
// for a stable average — the seed dominates wall-clock, so the default stays low.
const DEFAULT_SEED_COUNT = 10_000_000;
const DEFAULT_ITERATIONS = 50;

// Width of the seed grid in tiles. The seed spans CHUNK_SIZE-square chunks, so a
// 4096-wide grid of 10M belts covers roughly 64 x 39 chunks.
const SEED_GRID_WIDTH = 4096;

// Numbers (a core temp table) holds CHUNK_SIZE**2 rows (values 0..N-1); two of
// them cross-joined enumerate up to CHUNK_SIZE**4 distinct belt ids.
const NUMBERS_ROWS = CHUNK_SIZE ** 2;
const MAX_SEED_COUNT = NUMBERS_ROWS ** 2;

// The benchmark works far from the seed grid so its region is always empty. Each
// pattern iteration is handed a fresh, unused cell so placements never collide.
const BENCH_ORIGIN_X = 1_000_000;
const BENCH_ORIGIN_Y = 1_000_000;
const CELL_SIZE = 16;
const CELLS_PER_ROW = 256;

let cellIndex = 0;

/**
 * Hands out a fresh, never-reused empty cell origin for one pattern iteration.
 * @returns {{x: number, y: number}}
 */
function nextCell() {
    const col = cellIndex % CELLS_PER_ROW;
    const row = Math.floor(cellIndex / CELLS_PER_ROW);
    cellIndex += 1;
    return {
        x: BENCH_ORIGIN_X + col * CELL_SIZE,
        y: BENCH_ORIGIN_Y + row * CELL_SIZE,
    };
}

/**
 * The id of the surface belt at a tile (undergrounds excluded), or null. Uses raw
 * SQL so the lookup itself stays out of the profiled statement timings.
 * @param {TestHarness} game
 * @param {number} x
 * @param {number} y
 * @returns {BigInt|null}
 */
function idAt(game, x, y) {
    const id = game.rawScalar(
        `SELECT id FROM Belt WHERE x = ${x} AND y = ${y} AND type != ${BELT_UNDERGROUND} LIMIT 1`
    );
    if (id === undefined || id === null) {
        return null;
    }
    return BigInt(id);
}

/**
 * Deletes the surface belt at a tile if one is still there.
 * @param {TestHarness} game
 * @param {number} x
 * @param {number} y
 */
function deleteAt(game, x, y) {
    const id = idAt(game, x, y);
    if (id !== null) {
        deleteBelt(game, id);
    }
}

// ---- Patterns ----
//
// Each pattern builds a small configuration over a fresh empty cell and tears it
// back down, so both the create and delete handlers run. Together they cover the
// branches of the create/delete code: standalone placement, path extension, the
// fast standalone-child merge, a general merge that splits a parented child's
// path, loop close + loop-seam heal, and a ramp/underground tunnel cascade.

/**
 * Standalone placement then standalone deletion.
 */
function patternPlaceDelete(game) {
    const {x, y} = nextCell();
    createBelt(game, GameObject.BELT, {x, y, direction: Direction.RIGHT});
    deleteAt(game, x, y);
}

/**
 * Builds a straight run (each placement extends the path: head != id, no child),
 * then deletes the middle (splitting the run) followed by the two ends.
 */
function patternExtendRun(game) {
    const {x, y} = nextCell();
    createBelt(game, GameObject.BELT, {x, y, direction: Direction.RIGHT});
    createBelt(game, GameObject.BELT, {x: x + 1, y, direction: Direction.RIGHT});
    createBelt(game, GameObject.BELT, {x: x + 2, y, direction: Direction.RIGHT});
    deleteAt(game, x + 1, y);
    deleteAt(game, x, y);
    deleteAt(game, x + 2, y);
}

/**
 * Places a standalone belt then a belt feeding it from upstream, hitting the fast
 * standalone-child merge (the new belt becomes the path head).
 */
function patternPrependMerge(game) {
    const {x, y} = nextCell();
    createBelt(game, GameObject.BELT, {x: x + 1, y, direction: Direction.RIGHT});
    createBelt(game, GameObject.BELT, {x, y, direction: Direction.RIGHT});
    deleteAt(game, x, y);
    deleteAt(game, x + 1, y);
}

/**
 * Builds a run then feeds a belt into its middle (a child that already has a
 * parent), hitting the general merge that stashes and splits the old parent path.
 */
function patternBranchSplit(game) {
    const {x, y} = nextCell();
    createBelt(game, GameObject.BELT, {x, y, direction: Direction.RIGHT});
    createBelt(game, GameObject.BELT, {x: x + 1, y, direction: Direction.RIGHT});
    createBelt(game, GameObject.BELT, {x: x + 2, y, direction: Direction.RIGHT});
    createBelt(game, GameObject.BELT, {x: x + 1, y: y + 1, direction: Direction.UP});
    deleteAt(game, x + 1, y + 1);
    deleteAt(game, x, y);
    deleteAt(game, x + 1, y);
    deleteAt(game, x + 2, y);
}

/**
 * Closes a 4-belt ring into a loop path, then breaks it so a delete must re-link
 * the dangling loop seam.
 */
function patternLoop(game) {
    const {x, y} = nextCell();
    createBelt(game, GameObject.BELT, {x, y, direction: Direction.RIGHT});
    createBelt(game, GameObject.BELT, {x: x + 1, y, direction: Direction.DOWN});
    createBelt(game, GameObject.BELT, {x: x + 1, y: y + 1, direction: Direction.LEFT});
    createBelt(game, GameObject.BELT, {x, y: y + 1, direction: Direction.UP});
    deleteAt(game, x + 1, y + 1);
    deleteAt(game, x, y);
    deleteAt(game, x + 1, y);
    deleteAt(game, x, y + 1);
}

/**
 * Lays a ramp-down/ramp-up pair (creating the buried underground span), then
 * deletes the ramps so the deletion cascades through the tunnel.
 */
function patternRampTunnel(game) {
    const {x, y} = nextCell();
    createBelt(game, GameObject.RAMP_DOWN, {x, y, direction: Direction.RIGHT});
    const rampDownId = idAt(game, x, y);
    createBelt(game, GameObject.RAMP_UP, {x: x + 2, y, direction: Direction.RIGHT, rampParent: rampDownId});
    deleteAt(game, x, y);
    deleteAt(game, x + 2, y);
}

const PATTERNS = [
    {name: "place_delete", run: patternPlaceDelete},
    {name: "extend_run", run: patternExtendRun},
    {name: "prepend_merge", run: patternPrependMerge},
    {name: "branch_split", run: patternBranchSplit},
    {name: "loop_heal", run: patternLoop},
    {name: "ramp_tunnel", run: patternRampTunnel},
];

/**
 * Bulk-inserts `count` standalone belts (each its own single-belt path with one
 * item) spread across the seed grid, entirely in SQL. Belt/Port/BeltPath/item ids
 * are assigned deterministically from a fresh database so foreign keys line up
 * without per-row round-trips.
 * @param {NodeDatabase} db
 * @param {number} count
 */
function seedDatabase(db, count) {
    db.rawExec("BEGIN");

    // Belts: ids 1..count, fanned across the grid by id. Two cross-joined Numbers
    // rows enumerate the id space; keep the first `count`.
    db.rawExec(`
        INSERT INTO Belt (id, x, y, type, direction)
        SELECT n, (n - 1) % ${SEED_GRID_WIDTH}, (n - 1) / ${SEED_GRID_WIDTH}, ${BELT_NORMAL}, ${Direction.RIGHT}
        FROM (
            SELECT a.value * ${NUMBERS_ROWS} + b.value + 1 AS n
            FROM Numbers a, Numbers b
        )
        WHERE n <= ${count};
    `);

    // One in-port and one out-port per belt (ids 1..count and count+1..2*count).
    db.rawExec("INSERT INTO Port (id) SELECT id FROM Belt;");
    db.rawExec(`INSERT INTO Port (id) SELECT id + ${count} FROM Belt;`);

    // Each belt is its own single-belt path; in_port != out_port satisfies the CHECK.
    db.rawExec(`
        INSERT INTO BeltPath (id, tail_id, length, head_gap, in_port_id, out_port_id)
        SELECT id, id, 1, 0, id, id + ${count} FROM Belt;
    `);
    db.rawExec("UPDATE Belt SET path_id = id, path_index = 0;");

    // One real (non-gap) item per path, giving a comparable item count.
    db.rawExec("INSERT INTO BeltPathItem (path_id, length, type) SELECT id, 1, 1 FROM Belt;");

    db.rawExec("COMMIT");
}

/**
 * Prints every profiled statement (slowest total first) plus the zero-count ones.
 * @param {{name: string, count: number, total: number, mean: number}[]} summary
 */
function printReport(summary) {
    const rows = summary.map(row => ({
        statement: row.name,
        count: row.count,
        total_ms: Number(row.total.toFixed(2)),
        mean_ms: Number(row.mean.toFixed(4)),
    }));
    console.table(rows);
}

/**
 * Parses a positive-integer CLI arg, falling back to a default when absent. Zero
 * is honored (e.g. `iterations=0` seeds only) but negatives/NaN fall back.
 * @param {string|undefined} arg
 * @param {number} fallback
 * @returns {number}
 */
function intArg(arg, fallback) {
    if (arg === undefined) {
        return fallback;
    }
    const value = Number(arg);
    if (!Number.isInteger(value) || value < 0) {
        return fallback;
    }
    return value;
}

async function main() {
    const seedCount = Math.min(intArg(process.argv[2], DEFAULT_SEED_COUNT), MAX_SEED_COUNT);
    const iterations = intArg(process.argv[3], DEFAULT_ITERATIONS);

    const game = await setup();

    console.log(`Seeding ${seedCount.toLocaleString()} belts (+paths, +items)...`);
    const seedStart = performance.now();
    seedDatabase(game.db, seedCount);
    const seedMs = performance.now() - seedStart;

    const beltCount = game.rawScalar("SELECT COUNT(*) FROM Belt");
    const pathCount = game.rawScalar("SELECT COUNT(*) FROM BeltPath");
    const itemCount = game.rawScalar("SELECT COUNT(*) FROM BeltPathItem");
    console.log(
        `Seeded in ${(seedMs / 1000).toFixed(1)}s: `
        + `${beltCount.toLocaleString()} belts, ${pathCount.toLocaleString()} paths, ${itemCount.toLocaleString()} items.`
    );

    // Drop the setup/seed timings so the report reflects only the measured run.
    game.db.resetProfiling();

    console.log(`Running ${iterations.toLocaleString()} iterations of ${PATTERNS.length} patterns...`);
    let failures = 0;
    const runStart = performance.now();
    PATTERNS.forEach(pattern => {
        for (let i = 0; i < iterations; i += 1) {
            try {
                pattern.run(game);
            } catch (e) {
                failures += 1;
                // A throw can leave a half-open transaction; reset before continuing.
                try {
                    game.rawExec("ROLLBACK");
                } catch (rollbackError) {
                    // No open transaction to roll back; ignore.
                }
                if (failures <= 5) {
                    console.warn(`Pattern "${pattern.name}" failed:`, e.message);
                }
            }
        }
    });
    const runMs = performance.now() - runStart;

    console.log(
        `Measured run: ${(runMs / 1000).toFixed(2)}s, `
        + `${(iterations * PATTERNS.length).toLocaleString()} pattern iterations`
        + (failures > 0 ? `, ${failures} failed` : "")
        + ".\n"
    );

    printReport(game.db.profilingSummary());
}

main();
