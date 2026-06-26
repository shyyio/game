// Shared helpers for the belt benchmarks (Node-only). Both the create/delete
// benchmark and the tick benchmark seed the same large database and print the
// same per-statement profiling table, so that machinery lives here.

import {BELT_NORMAL} from "@/mods/Belt/constants.js";
import {Direction, CHUNK_SIZE} from "@/common/constants.js";

// Width of the seed grid in tiles. The seed spans CHUNK_SIZE-square chunks, so a
// 4096-wide grid of 10M belts covers roughly 64 x 39 chunks.
export const SEED_GRID_WIDTH = 4096;

// Numbers (a core temp table) holds CHUNK_SIZE**2 rows (values 0..N-1); two of
// them cross-joined enumerate up to CHUNK_SIZE**4 distinct belt ids.
const NUMBERS_ROWS = CHUNK_SIZE ** 2;
export const MAX_SEED_COUNT = NUMBERS_ROWS ** 2;

/**
 * Bulk-inserts `count` standalone belts (each its own single-belt path with one
 * item) spread across the seed grid, entirely in SQL. Belt/Port/BeltPath/item ids
 * are assigned deterministically from a fresh database so foreign keys line up
 * without per-row round-trips.
 * @param {NodeDatabase} db
 * @param {number} count
 */
export function seedDatabase(db, count) {
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

    // Point each path at its item, as a live game would: the tick's incremental
    // recalc only fixes paths whose items change, so a valid seed must already have
    // next_item_id set (next_gap_id stays NULL — the seed has no gap items).
    db.rawExec("UPDATE BeltPath SET next_item_id = (SELECT MIN(id) FROM BeltPathItem WHERE path_id = BeltPath.id);");

    db.rawExec("COMMIT");
}

/**
 * Prints every profiled statement (slowest total first) plus the zero-count ones.
 * @param {{name: string, count: number, total: number, mean: number}[]} summary
 */
export function printReport(summary) {
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
 * is honored but negatives/NaN fall back.
 * @param {string|undefined} arg
 * @param {number} fallback
 * @returns {number}
 */
export function intArg(arg, fallback) {
    if (arg === undefined) {
        return fallback;
    }
    const value = Number(arg);
    if (!Number.isInteger(value) || value < 0) {
        return fallback;
    }
    return value;
}
