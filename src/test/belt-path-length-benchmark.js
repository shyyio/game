// Belt path-length tick benchmark (Node-only).
//
//   node --import ./src/test/test-loader.js src/test/belt-path-length-benchmark.js [paths]
//   npm run bench:pathlen -- [paths]
//
// Demonstrates that the tick cost is per *path*, not per item/belt: it builds the
// same number of straight belt runs at several lengths L (each run is one path),
// puts one item at each run's output, and times the single tick that pops them.
// If a length-L path costs the same as a length-1 path, us/belt should fall ~1/L.

import {setup} from "@/test/common.js";
import {GameObject, createBelt} from "@/mods/Logistics/testHelpers.js";
import {intArg} from "@/test/belt-benchmark-common.js";
import {Direction} from "@/common/constants.js";

// Lengths to compare. Kept <= CHUNK_SIZE so each run stays a single path (paths
// split at chunk borders).
const LENGTHS = [1, 4, 16, 64];

/**
 * Builds `paths` straight rightward runs of length `len`, one per row (rows spaced
 * by 2 so neighboring runs never connect), then times one tick popping them.
 * @param {number} paths
 * @param {number} len
 * @returns {{belts: number, active: number, tickMs: number}}
 */
async function measure(paths, len) {
    const game = await setup();

    for (let p = 0; p < paths; p += 1) {
        const y = p * 2;
        for (let x = 0; x < len; x += 1) {
            createBelt(game, GameObject.BELT, {x, y, direction: Direction.RIGHT});
        }
    }

    // Put one item at each run's output tile, ready to pop next tick: one row per
    // path (path_id is the head belt's id), head_gap leaving it at the tail end.
    game.rawExec("INSERT INTO BeltPathItem (path_id, length, type) SELECT id, 1, 1 FROM BeltPath;");
    game.rawExec(`
        UPDATE BeltPath
        SET head_gap = length - 1,
            next_item_id = (SELECT MIN(id) FROM BeltPathItem WHERE path_id = BeltPath.id);
    `);

    game.db.resetProfiling();
    game.tickAll();

    const belts = game.rawScalar("SELECT COUNT(*) FROM Belt");
    const active = game.rawScalar("SELECT COUNT(*) FROM ActivePath");
    const tickMs = game.db.profilingSummary().reduce((sum, row) => sum + row.total, 0);
    return {belts, active, tickMs};
}

async function main() {
    const paths = intArg(process.argv[2], 5000);

    console.log(`Path-length tick benchmark: ${paths.toLocaleString()} paths per run.\n`);
    console.log("len\tbelts\tactive\ttick_ms\tus/path\tus/belt");

    for (const len of LENGTHS) {
        const {belts, active, tickMs} = await measure(paths, len);
        console.log(
            `${len}\t${belts.toLocaleString()}\t${active.toLocaleString()}\t${tickMs.toFixed(1)}`
            + `\t${((tickMs * 1000) / active).toFixed(2)}\t${((tickMs * 1000) / belts).toFixed(2)}`
        );
    }
}

main();
