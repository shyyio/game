
import {test} from "node:test";
import assert from "node:assert/strict";
import {setup} from "@/test/common.js";
import {GameObject, createBelt, deleteBelt} from "./testHelpers.js";
import {BeltType, MAX_UNDERGROUND_LENGTH} from "./constants.js";
import {Direction} from "@/common/constants.js";

// A 3x3 ring of normal belts (ids 1..8, clockwise from the top-left). id1 is the
// loop's seam head (its parent is nulled); id8 physically feeds it.
async function buildRing3x3() {
    const game = await setup();
    createBelt(game, GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    createBelt(game, GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});
    createBelt(game, GameObject.BELT, {x: 2, y: 0, direction: Direction.DOWN});
    createBelt(game, GameObject.BELT, {x: 2, y: 1, direction: Direction.DOWN});
    createBelt(game, GameObject.BELT, {x: 2, y: 2, direction: Direction.LEFT});
    createBelt(game, GameObject.BELT, {x: 1, y: 2, direction: Direction.LEFT});
    createBelt(game, GameObject.BELT, {x: 0, y: 2, direction: Direction.UP});
    createBelt(game, GameObject.BELT, {x: 0, y: 1, direction: Direction.UP});
    return game;
}

test("Sets each belt's parent to the belt it flows into", async () => {
    const game = await setup();

    createBelt(game, GameObject.BELT, {x: 0, y: 0, direction: Direction.UP});
    createBelt(game, GameObject.BELT, {x: 0, y: -1, direction: Direction.RIGHT});
    createBelt(game, GameObject.BELT, {x: 0, y: 1, direction: Direction.UP});

    assert.equal(game.rawScalar("SELECT parent_id FROM Belt WHERE id=1"), 3);
    assert.equal(game.rawScalar("SELECT parent_id FROM Belt WHERE id=2"), 1);

    createBelt(game, GameObject.BELT, {x: 1, y: 1, direction: Direction.LEFT});
    assert.equal(game.rawScalar("SELECT parent_id FROM Belt WHERE id=3"), 4);

    createBelt(game, GameObject.BELT, {x: -1, y: 0, direction: Direction.RIGHT});
    assert.equal(game.rawScalar("SELECT parent_id FROM Belt WHERE id=1"), 5);

    createBelt(game, GameObject.BELT, {x: 1, y: 0, direction: Direction.LEFT});
    assert.equal(game.rawScalar("SELECT parent_id FROM Belt WHERE id=1"), 6);
});

test("Builds BeltPaths with correct length and tail across straight runs", async () => {
    const game = await setup();
    createBelt(game, GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    createBelt(game, GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});
    createBelt(game, GameObject.BELT, {x: 2, y: 0, direction: Direction.RIGHT});

    assert.equal(game.rawScalar("SELECT length=(3*2-1) AND id=1 AND tail_id=3 FROM BeltPath"), 1);

    createBelt(game, GameObject.BELT, {x: 1, y: 2, direction: Direction.UP});
    createBelt(game, GameObject.BELT, {x: 1, y: 1, direction: Direction.UP});

    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE length=(4*2-1) AND id=4 AND tail_id=3"), 1);
    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE length=1 AND id=1 AND tail_id=1"), 1);
    assert.equal(game.rawScalar("SELECT Count(*) FROM Port"), 4);
});

test("Moves the output item to the tail path when a branch splits a run", async () => {
    const game = await setup();
    createBelt(game, GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    createBelt(game, GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});
    createBelt(game, GameObject.BELT, {x: 2, y: 0, direction: Direction.RIGHT});

    game.rawExec("UPDATE Port SET item=2 WHERE id=(SELECT out_port_id FROM BeltPath WHERE id=1)");

    createBelt(game, GameObject.BELT, {x: 1, y: 1, direction: Direction.UP});

    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath INNER JOIN Port ON port.id=out_port_id WHERE BeltPath.id=1 AND item IS NULL"), 1);
    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath INNER JOIN Port ON port.id=out_port_id WHERE BeltPath.id=4 AND item=2"), 1);
    assert.equal(game.rawScalar("SELECT Count(*) FROM Port"), 4);
});

test("Keeps the output item when a belt is prepended to a run", async () => {
    const game = await setup();
    createBelt(game, GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});

    game.rawExec("UPDATE Port SET item=2 WHERE id=(SELECT out_port_id FROM BeltPath WHERE id=1)");

    createBelt(game, GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});

    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath INNER JOIN Port ON port.id=out_port_id WHERE BeltPath.id=2 AND item=2"), 1);
    assert.equal(game.rawScalar("SELECT Count(*) FROM Port"), 2);
});

test("Retains an in-flight item when a belt is prepended", async () => {
    const game = await setup();
    createBelt(game, GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});

    game.rawExec("UPDATE Port SET item=1 WHERE id=(SELECT in_port_id FROM BeltPath WHERE id=1)");
    game.tickAll();

    createBelt(game, GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});

    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE id=2 AND next_item_id IS NOT NULL"), 1);
    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath INNER JOIN Port ON port.id=in_port_id WHERE BeltPath.id=2 AND item IS NULL"), 1);
});

test("Forms a closed loop into a single path with no parent", async () => {
    const game = await setup();
    createBelt(game, GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    createBelt(game, GameObject.BELT, {x: 1, y: 0, direction: Direction.DOWN});
    createBelt(game, GameObject.BELT, {x: 1, y: 1, direction: Direction.LEFT});
    createBelt(game, GameObject.BELT, {x: 0, y: 1, direction: Direction.UP});

    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE length=(4*2-1) AND id=1 AND tail_id=4"), 1);
    assert.equal(game.rawScalar("SELECT parent_id FROM Belt WHERE id=1"), null);
});

test("Merges the remainder of a loop into one path when a belt is deleted", async () => {
    const game = await buildRing3x3();

    // Removing one belt leaves the other seven physically connected in a single
    // open run, exactly as building those seven fresh would produce. The old loop
    // seam (the belt whose parent was nulled) must be re-linked into that run.
    deleteBelt(game, 5n);

    assert.equal(game.rawScalar("SELECT COUNT(*) FROM BeltPath"), 1);
    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE length=(7*2-1)"), 1);
});

test("Heals a loop seam past an incompatible higher-id belt at the seam tile", async () => {
    const game = await buildRing3x3();

    // The seam head (belt 1 at (0,0) facing RIGHT) is really fed by belt 8 from (0,1).
    // Drop a ramp-down at (0,-1) facing DOWN: it points into the seam tile too and gets
    // a higher id than belt 8, but a ramp-down→normal bend is not a valid connection, so
    // it is not the loop's feeder and belt 1 must stay parentless when it is placed.
    createBelt(game, GameObject.RAMP_DOWN, {x: 0, y: -1, direction: Direction.DOWN});
    assert.equal(game.rawScalar("SELECT parent_id FROM Belt WHERE id=1"), null);

    // Deleting a ring belt must still heal the seam by re-linking belt 1 to its real,
    // compatible feeder (belt 8) — not the higher-id incompatible ramp — so the seven
    // ring belts collapse back into one connected run.
    deleteBelt(game, 5n);

    assert.equal(game.rawScalar("SELECT parent_id FROM Belt WHERE id=1"), 8);
    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE length=(7*2-1)"), 1);
});

test("Opens a loop cleanly when its seam head is deleted", async () => {
    const game = await buildRing3x3();

    // Deleting the seam head removes the only nulled-parent belt, so there is no
    // seam left to re-link; the rest is one open run.
    deleteBelt(game, 1n);

    assert.equal(game.rawScalar("SELECT COUNT(*) FROM BeltPath"), 1);
    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE length=(7*2-1)"), 1);
});

test("Opens a loop cleanly when the seam's feeder belt is deleted", async () => {
    const game = await buildRing3x3();

    // Deleting the feeder leaves the seam head parentless with nothing to re-link to.
    deleteBelt(game, 8n);

    assert.equal(game.rawScalar("SELECT COUNT(*) FROM BeltPath"), 1);
    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE length=(7*2-1)"), 1);
});

test("Shares ports between belts that link head-to-tail", async () => {
    const game = await setup();
    createBelt(game, GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    createBelt(game, GameObject.BELT, {x: -1, y: 0, direction: Direction.RIGHT});
    assert.equal(game.rawScalar("SELECT (SELECT in_port_id FROM BeltPath WHERE id=1) = (SELECT out_port_id FROM BeltPath WHERE id=2)"), 1);

    createBelt(game, GameObject.BELT, {x: 0, y: -1, direction: Direction.DOWN});
    assert.equal(game.rawScalar("SELECT (SELECT in_port_id FROM BeltPath WHERE id=1) = (SELECT out_port_id FROM BeltPath WHERE id=3)"), 1);

    assert.equal(game.rawScalar("SELECT COUNT(*) FROM Port"), 5);
});

test("Leaves head_gap unchanged when the belt is empty", async () => {
    const game = await setup();
    createBelt(game, GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    createBelt(game, GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});
    createBelt(game, GameObject.BELT, {x: 2, y: 0, direction: Direction.RIGHT});

    assert.equal(game.rawScalar("SELECT head_gap FROM BeltPath WHERE id=1"), 3*2-1);

    game.tickAll();

    assert.equal(game.rawScalar("SELECT head_gap FROM BeltPath WHERE id=1"), 3*2-1);
});

test("Advances a single item along the belt to its output", async () => {
    const game = await setup();
    createBelt(game, GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    createBelt(game, GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});
    createBelt(game, GameObject.BELT, {x: 2, y: 0, direction: Direction.RIGHT});

    assert.equal(game.rawScalar("SELECT head_gap FROM BeltPath WHERE id=1"), 3*2-1);

    game.rawExec("UPDATE Port SET item=1 WHERE id=(SELECT in_port_id FROM BeltPath WHERE id=1)");

    game.tickAll();
    assert.equal(game.rawScalar("SELECT head_gap FROM BeltPath WHERE id=1"), 0);

    game.tickAll();
    assert.equal(game.rawScalar("SELECT head_gap FROM BeltPath WHERE id=1"), 1);

    game.tickAll();
    game.tickAll();
    assert.equal(game.rawScalar("SELECT head_gap FROM BeltPath WHERE id=1"), 3);
    game.tickAll();
    game.tickAll();
    assert.equal(game.rawScalar("SELECT item FROM Port WHERE id=(SELECT out_port_id FROM BeltPath WHERE id=1)"), 1);
});

test("Advances two spaced items and stalls them at a blocked output", async () => {
    const game = await setup();
    createBelt(game, GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    createBelt(game, GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});
    createBelt(game, GameObject.BELT, {x: 2, y: 0, direction: Direction.RIGHT});

    assert.equal(game.rawScalar("SELECT head_gap FROM BeltPath WHERE id=1"), 3*2-1);

    game.rawExec("UPDATE Port SET item=1 WHERE id=(SELECT in_port_id FROM BeltPath WHERE id=1)");
    game.tickAll();
    game.tickAll();
    game.rawExec("UPDATE Port SET item=1 WHERE id=(SELECT in_port_id FROM BeltPath WHERE id=1)");
    game.tickAll();

    assert.equal(game.rawScalar("SELECT head_gap FROM BeltPath WHERE id=1"), 0);

    game.tickAll();
    game.tickAll();
    assert.equal(game.rawScalar("SELECT head_gap FROM BeltPath WHERE id=1"), 2);
    game.tickAll();
    assert.equal(game.rawScalar("SELECT item FROM Port WHERE id=(SELECT out_port_id FROM BeltPath WHERE id=1)"), 1);

    game.tickAll();
    assert.equal(game.rawScalar("SELECT head_gap FROM BeltPath WHERE id=1"), 4);

    game.rawExec("UPDATE Port SET item=NULL WHERE id=(SELECT out_port_id FROM BeltPath WHERE id=1)");
    game.tickAll();
    assert.equal(game.rawScalar("SELECT head_gap FROM BeltPath WHERE id=1"), 5);
    assert.equal(game.rawScalar("SELECT item FROM Port WHERE id=(SELECT out_port_id FROM BeltPath WHERE id=1)"), 1);
});

test("Stashes items when the tail belt is deleted", async () => {
    const game = await setup();
    createBelt(game, GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    createBelt(game, GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});
    createBelt(game, GameObject.BELT, {x: 2, y: 0, direction: Direction.RIGHT});

    game.rawExec("UPDATE Port SET item=1 WHERE id=(SELECT in_port_id FROM BeltPath WHERE id=1)");
    game.rawExec("UPDATE Port SET item=2 WHERE id=(SELECT out_port_id FROM BeltPath WHERE id=1)");
    game.tickAll();

    deleteBelt(game, 3n);

    assert.equal(game.rawScalar("SELECT 1 FROM Port WHERE id=(SELECT out_port_id FROM BeltPath WHERE id=1) AND item IS NULL"), 1);
    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE id=1 AND next_gap_id=3 AND next_item_id=4"), 1);
    assert.equal(game.rawScalar("SELECT 1 FROM BeltPathItem WHERE id=3 AND length=2"), 1);
});

test("Splits the path and stashes items when a middle belt is deleted", async () => {
    const game = await setup();
    createBelt(game, GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    createBelt(game, GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});
    createBelt(game, GameObject.BELT, {x: 2, y: 0, direction: Direction.RIGHT});

    game.rawExec("UPDATE Port SET item=1 WHERE id=(SELECT in_port_id FROM BeltPath WHERE id=1)");
    game.rawExec("UPDATE Port SET item=2 WHERE id=(SELECT out_port_id FROM BeltPath WHERE id=1)");
    game.tickAll();

    deleteBelt(game, 2n);

    assert.equal(game.rawScalar("SELECT 1 FROM Port WHERE id=(SELECT out_port_id FROM BeltPath WHERE id=1) AND item IS NULL"), 1);
    assert.equal(game.rawScalar("SELECT 1 FROM Port WHERE id=(SELECT out_port_id FROM BeltPath WHERE id=3) AND item=2"), 1);

    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE id=1 AND head_gap=0 AND next_gap_id IS NULL AND next_item_id IS NOT NULL"), 1);
    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE id=3 AND head_gap=1 AND next_gap_id IS NULL AND next_item_id IS NULL"), 1);
});

test("Keeps downstream items when the head belt is deleted", async () => {
    const game = await setup();
    createBelt(game, GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    createBelt(game, GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});
    createBelt(game, GameObject.BELT, {x: 2, y: 0, direction: Direction.RIGHT});

    game.rawExec("UPDATE Port SET item=1 WHERE id=(SELECT in_port_id FROM BeltPath WHERE id=1)");
    game.rawExec("UPDATE Port SET item=2 WHERE id=(SELECT out_port_id FROM BeltPath WHERE id=1)");
    game.tickAll();

    deleteBelt(game, 1n);

    assert.equal(game.rawScalar("SELECT 1 FROM Port WHERE id=(SELECT out_port_id FROM BeltPath WHERE id=2) AND item=2"), 1);
    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE id=2 AND head_gap=(2*2-1) AND next_gap_id IS NULL AND next_item_id IS NULL"), 1);
});

test("Keeps a waiting item in place when the path is extended", async () => {
    const game = await setup();
    createBelt(game, GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    createBelt(game, GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});

    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE id=1 AND head_gap=(2*2-1)"), 1);

    game.rawExec("UPDATE Port SET item=1 WHERE id=(SELECT in_port_id FROM BeltPath WHERE id=1)");
    game.tickAll();

    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE id=1 AND head_gap=0"), 1);

    createBelt(game, GameObject.BELT, {x: 2, y: 0, direction: Direction.RIGHT});

    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE id=1 AND head_gap=0"), 1);
});

test("Cleans up shared ports when the child belt is deleted", async () => {
    const game = await setup();
    createBelt(game, GameObject.BELT, {x: -1, y: 0, direction: Direction.RIGHT});
    createBelt(game, GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});

    assert.equal(game.rawScalar("SELECT (SELECT out_port_id FROM BeltPath WHERE id=1) = (SELECT in_port_id FROM BeltPath WHERE id=2)"), 1);
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM Port"), 3);

    deleteBelt(game, 2n);

    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE in_port_id IS NULL OR out_port_id IS NULL"), undefined);
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM Port"), 2);
});

test("Cleans up shared ports when the parent belt is deleted", async () => {
    const game = await setup();
    createBelt(game, GameObject.BELT, {x: -1, y: 0, direction: Direction.RIGHT});
    createBelt(game, GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});

    assert.equal(game.rawScalar("SELECT (SELECT out_port_id FROM BeltPath WHERE id=1) = (SELECT in_port_id FROM BeltPath WHERE id=2)"), 1);

    deleteBelt(game, 1n);

    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE in_port_id IS NULL OR out_port_id IS NULL"), undefined);
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM Port"), 2);
});

test("Spans an upward tunnel with one BeltPath through ramps", async () => {
    const game = await setup();
    createBelt(game, GameObject.BELT, {x: 0, y: 10, direction: Direction.RIGHT});
    createBelt(game, GameObject.BELT, {x: 1, y: 10, direction: Direction.RIGHT});
    createBelt(game, GameObject.BELT, {x: 2, y: 10, direction: Direction.RIGHT});

    createBelt(game, GameObject.BELT, {x: 1, y: 12, direction: Direction.UP});
    createBelt(game, GameObject.RAMP_DOWN, {x: 1, y: 11, direction: Direction.UP});
    createBelt(game, GameObject.RAMP_UP, {x: 1, y: 9, direction: Direction.UP, rampParent: 5n});
    createBelt(game, GameObject.BELT, {x: 1, y: 8, direction: Direction.UP});

    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE id=1 AND length=(3*2-1)"), 1);
    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE id=4 AND length=(5*2-1)"), 1);
});

test("Connects adjacent ramps with zero gap", async () => {
    const game = await setup();
    createBelt(game, GameObject.RAMP_DOWN, {x: 1, y: 10, direction: Direction.UP});
    createBelt(game, GameObject.RAMP_UP, {x: 1, y: 9, direction: Direction.UP, rampParent: 1n});

    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE id=1 AND length=(2*2-1)"), 1);
});

test("Connects adjacent reversed ramps with zero gap", async () => {
    const game = await setup();
    createBelt(game, GameObject.RAMP_UP, {x: 1, y: 0, direction: Direction.LEFT});
    createBelt(game, GameObject.RAMP_DOWN, {x: 2, y: 0, direction: Direction.LEFT, rampParent: 1n});

    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE id=2 AND length=(2*2-1)"), 1);
});

test("Spans a leftward tunnel with one BeltPath through ramps", async () => {
    const game = await setup();
    createBelt(game, GameObject.BELT, {x: 10, y: 0, direction: Direction.DOWN});
    createBelt(game, GameObject.BELT, {x: 10, y: 1, direction: Direction.DOWN});
    createBelt(game, GameObject.BELT, {x: 10, y: 2, direction: Direction.DOWN});

    createBelt(game, GameObject.BELT, {x: 12, y: 1, direction: Direction.LEFT});
    createBelt(game, GameObject.RAMP_DOWN, {x: 11, y: 1, direction: Direction.LEFT});
    createBelt(game, GameObject.RAMP_UP, {x: 9, y: 1, direction: Direction.LEFT, rampParent: 5n});
    createBelt(game, GameObject.BELT, {x: 8, y: 1, direction: Direction.LEFT});

    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE id=1 AND length=(3*2-1)"), 1);
    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE id=4 AND length=(5*2-1)"), 1);
});

test("Connects ramps at the maximum tunnel length", async () => {
    const game = await setup();
    createBelt(game, GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT});
    createBelt(game, GameObject.RAMP_UP, {x: 1 + MAX_UNDERGROUND_LENGTH + 1, y: 1, direction: Direction.RIGHT, rampParent: 1n});
    assert.equal(game.rawScalar(`SELECT 1 FROM BeltPath WHERE id=1 AND length=${(MAX_UNDERGROUND_LENGTH + 2)*2-1}`), 1);
});

test("Connects ramps placed in reverse at the maximum tunnel length", async () => {
    const game = await setup();
    createBelt(game, GameObject.RAMP_UP, {x: 1 + MAX_UNDERGROUND_LENGTH + 1, y: 1, direction: Direction.RIGHT});
    createBelt(game, GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    assert.equal(game.rawScalar(`SELECT 1 FROM BeltPath WHERE id=${MAX_UNDERGROUND_LENGTH + 2} AND length=${(MAX_UNDERGROUND_LENGTH + 2)*2-1}`), 1);
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM BeltPath"), 1);
});

test("Does not connect ramps beyond the maximum tunnel length", async () => {
    const game = await setup();
    createBelt(game, GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT});
    createBelt(game, GameObject.RAMP_UP, {x: 1 + MAX_UNDERGROUND_LENGTH + 2, y: 1, direction: Direction.RIGHT, rampParent: 1n});
    assert.equal(game.rawScalar(`SELECT 1 FROM BeltPath WHERE id=1 AND length=${(MAX_UNDERGROUND_LENGTH + 3)*2-1}`), undefined);
});

test("Leaves over-long reversed ramps unconnected", async () => {
    const game = await setup();
    createBelt(game, GameObject.RAMP_UP, {x: 1 + MAX_UNDERGROUND_LENGTH + 2, y: 1, direction: Direction.RIGHT});
    createBelt(game, GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    assert.equal(game.rawScalar(`SELECT 1 FROM BeltPath WHERE id=${MAX_UNDERGROUND_LENGTH + 3} AND length=${(MAX_UNDERGROUND_LENGTH + 3)*2-1}`), undefined);
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM BeltPath"), 2);
});

test("Collapses the tunnel when the up ramp is deleted", async () => {
    const game = await setup();
    createBelt(game, GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT});
    createBelt(game, GameObject.RAMP_UP, {x: 3, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    deleteBelt(game, 3n);

    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE id=1 AND length=1"), 1);
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM Belt"), 1);
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM BeltPath"), 1);
});

test("Collapses the tunnel when the down ramp is deleted", async () => {
    const game = await setup();
    createBelt(game, GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT});
    createBelt(game, GameObject.RAMP_UP, {x: 3, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    deleteBelt(game, 1n);

    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE id=3 AND length=1"), 1);
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM Belt"), 1);
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM BeltPath"), 1);
});

test("Stashes the tunnel item when the down ramp is deleted", async () => {
    const game = await setup();
    createBelt(game, GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT});
    createBelt(game, GameObject.RAMP_UP, {x: 3, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    game.rawExec("UPDATE Port SET item=1 WHERE id=(SELECT in_port_id FROM BeltPath WHERE id=1)");
    game.tickAll();

    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE id=1 AND length=(3*2-1) AND head_gap=0"), 1);

    deleteBelt(game, 3n);

    assert.equal(game.rawScalar("SELECT 1 FROM BeltPathItem WHERE path_id=1 AND type=1"), 1);
    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE id=1 AND length=1 AND head_gap=0"), 1);
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM Belt"), 1);
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM BeltPath"), 1);
});

test("Leaves no stash when the down ramp is deleted after the item advances past the tunnel", async () => {
    const game = await setup();
    createBelt(game, GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT});
    createBelt(game, GameObject.RAMP_UP, {x: 3, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    game.rawExec("UPDATE Port SET item=1 WHERE id=(SELECT in_port_id FROM BeltPath WHERE id=1)");
    game.tickAll();
    game.tickAll();

    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE id=1 AND length=(3*2-1) AND head_gap=1"), 1);

    deleteBelt(game, 3n);

    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE id=1 AND length=1 AND head_gap=1"), 1);
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM Belt"), 1);
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM BeltPath"), 1);
    assert.equal(game.rawScalar("SELECT 1 FROM BeltPathItem"), undefined);
});

test("Collapses a zero-gap tunnel when the down ramp is deleted", async () => {
    const game = await setup();
    createBelt(game, GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT});
    createBelt(game, GameObject.RAMP_UP, {x: 2, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    deleteBelt(game, 1n);

    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE id=2 AND length=1"), 1);
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM Belt"), 1);
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM BeltPath"), 1);
});

test("Collapses a zero-gap tunnel when the up ramp is deleted", async () => {
    const game = await setup();
    createBelt(game, GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT});
    createBelt(game, GameObject.RAMP_UP, {x: 2, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    deleteBelt(game, 2n);

    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE id=1 AND length=1"), 1);
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM Belt"), 1);
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM BeltPath"), 1);
});

test("Reconnects a surviving entrance to a free exit in range when the paired exit is deleted", async () => {
    const game = await setup();
    createBelt(game, GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT});
    createBelt(game, GameObject.RAMP_UP, {x: 3, y: 1, direction: Direction.RIGHT, rampParent: 1n});
    createBelt(game, GameObject.RAMP_UP, {x: 5, y: 1, direction: Direction.RIGHT});

    deleteBelt(game, 3n);

    // Entrance 1 re-tunnels across the freed tiles to the lone exit 4, forming one path.
    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE id=1 AND length=(5*2-1)"), 1);
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM Belt"), 5);
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM BeltPath"), 1);
    assert.equal(game.rawScalar("SELECT COUNT(DISTINCT path_id) FROM Belt"), 1);
});

test("Reconnects a surviving exit to a free entrance in range when the paired entrance is deleted", async () => {
    const game = await setup();
    createBelt(game, GameObject.RAMP_DOWN, {x: 3, y: 1, direction: Direction.RIGHT});
    createBelt(game, GameObject.RAMP_UP, {x: 5, y: 1, direction: Direction.RIGHT, rampParent: 1n});
    createBelt(game, GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT});

    deleteBelt(game, 1n);

    // Exit 3 re-tunnels back to the lone entrance 4, which heads the new path.
    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE id=4 AND length=(5*2-1)"), 1);
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM Belt"), 5);
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM BeltPath"), 1);
    assert.equal(game.rawScalar("SELECT COUNT(DISTINCT path_id) FROM Belt"), 1);
});

test("Preserves a stalled item when a surviving entrance re-tunnels to a free exit", async () => {
    const game = await setup();
    createBelt(game, GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT});
    createBelt(game, GameObject.RAMP_UP, {x: 3, y: 1, direction: Direction.RIGHT, rampParent: 1n});
    createBelt(game, GameObject.RAMP_UP, {x: 5, y: 1, direction: Direction.RIGHT});

    game.rawExec("UPDATE Port SET item=1 WHERE id=(SELECT in_port_id FROM BeltPath WHERE id=1)");
    game.tickAll();

    deleteBelt(game, 3n);

    // The in-flight item rides onto the re-tunnelled path rather than vanishing.
    assert.equal(game.rawScalar("SELECT 1 FROM BeltPathItem WHERE path_id=1 AND type=1"), 1);
    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE id=1 AND length=(5*2-1)"), 1);
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM Belt"), 5);
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM BeltPath"), 1);
});

test("Does not reconnect a surviving entrance through an intervening same-type ramp", async () => {
    const game = await setup();
    createBelt(game, GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT});
    createBelt(game, GameObject.RAMP_UP, {x: 3, y: 1, direction: Direction.RIGHT, rampParent: 1n});
    createBelt(game, GameObject.RAMP_DOWN, {x: 5, y: 1, direction: Direction.RIGHT});

    deleteBelt(game, 3n);

    // The only ramp in range is another entrance, which blocks pairing; 1 stays lone.
    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE id=1 AND length=1"), 1);
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM Belt"), 2);
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM BeltPath"), 2);
});

test("Does not reconnect a surviving entrance to an exit beyond tunnel range", async () => {
    const game = await setup();
    createBelt(game, GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT});
    createBelt(game, GameObject.RAMP_UP, {x: 3, y: 1, direction: Direction.RIGHT, rampParent: 1n});
    createBelt(game, GameObject.RAMP_UP, {x: 1 + MAX_UNDERGROUND_LENGTH + 2, y: 1, direction: Direction.RIGHT});

    deleteBelt(game, 3n);

    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE id=1 AND length=1"), 1);
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM Belt"), 2);
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM BeltPath"), 2);
});

test("Skips reconnection when a crossing tunnel buries the gap, leaving the deletion intact", async () => {
    const game = await setup();
    createBelt(game, GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT});
    createBelt(game, GameObject.RAMP_UP, {x: 3, y: 1, direction: Direction.RIGHT, rampParent: 1n});
    createBelt(game, GameObject.RAMP_UP, {x: 5, y: 1, direction: Direction.RIGHT});

    // A perpendicular tunnel buries an underground at (4,1), inside the would-be gap.
    createBelt(game, GameObject.RAMP_DOWN, {x: 4, y: -1, direction: Direction.DOWN});
    createBelt(game, GameObject.RAMP_UP, {x: 4, y: 2, direction: Direction.DOWN, rampParent: 5n});

    deleteBelt(game, 3n);

    // A new underground would collide with the crossing one, so 1 stays lone and the
    // crossing tunnel is untouched.
    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE id=1 AND length=1"), 1);
    assert.equal(game.rawScalar(`SELECT 1 FROM Belt WHERE x=4 AND y=1 AND type=${BeltType.UNDERGROUND}`), 1);
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM Belt"), 6);
});

test("Moves items through a zero-gap tunnel across a chunk boundary and collapses on delete", async () => {
    const game = await setup();
    createBelt(game, GameObject.RAMP_DOWN, {x: -1, y: 1, direction: Direction.RIGHT});
    createBelt(game, GameObject.RAMP_UP, {x: 0, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    assert.equal(game.rawScalar("SELECT (SELECT out_port_id FROM BeltPath WHERE id=1) = (SELECT in_port_id FROM BeltPath WHERE id=2)"), 1);

    game.rawExec("UPDATE Port SET item=1 WHERE id=(SELECT in_port_id FROM BeltPath WHERE id=1)");
    game.tickAll();
    game.tickAll();

    assert.equal(game.rawScalar("SELECT 1 FROM BeltPathItem WHERE path_id=2"), 1);
    game.tickAll();
    assert.equal(game.rawScalar("SELECT 1 FROM Port WHERE id=(SELECT out_port_id FROM BeltPath WHERE id=2) AND item=1"), 1);

    deleteBelt(game, 1n);

    assert.equal(game.rawScalar("SELECT (SELECT out_port_id FROM BeltPath WHERE id=1) = (SELECT in_port_id FROM BeltPath WHERE id=2)"), null);
    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE in_port_id IS NULL OR out_port_id IS NULL"), undefined);

    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE id=2 AND length=1"), 1);
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM Belt"), 1);
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM BeltPath"), 1);
});

test("Carries an item through a tunnel crossing a chunk boundary", async () => {
    const game = await setup();
    createBelt(game, GameObject.RAMP_DOWN, {x: -1, y: 1, direction: Direction.RIGHT});
    createBelt(game, GameObject.RAMP_UP, {x: 1, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    assert.equal(game.rawScalar("SELECT (SELECT out_port_id FROM BeltPath WHERE id=1) = (SELECT in_port_id FROM BeltPath WHERE id=2)"), 1);
    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE id=1 AND length=1"), 1);
    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE id=2 AND length=(2*2-1)"), 1);

    game.rawExec("UPDATE Port SET item=1 WHERE id=(SELECT in_port_id FROM BeltPath WHERE id=1)");
    game.tickAll();
    game.tickAll();
    game.tickAll();

    assert.equal(game.rawScalar("SELECT 1 FROM BeltPathItem WHERE path_id=2"), 1);
});

test("Spans a tunnel across a chunk boundary with correct lengths", async () => {
    const game = await setup();
    createBelt(game, GameObject.RAMP_DOWN, {x: -2, y: 1, direction: Direction.RIGHT});
    createBelt(game, GameObject.RAMP_UP, {x: 0, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    assert.equal(game.rawScalar("SELECT (SELECT out_port_id FROM BeltPath WHERE id=1) = (SELECT in_port_id FROM BeltPath WHERE id=3)"), 1);
    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE id=1 AND length=(2*2-1)"), 1);
    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE id=3 AND length=1"), 1);
});

test("Spans a longer tunnel across a chunk boundary", async () => {
    const game = await setup();
    createBelt(game, GameObject.RAMP_DOWN, {x: -2, y: 1, direction: Direction.RIGHT});
    createBelt(game, GameObject.RAMP_UP, {x: 1, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    assert.equal(game.rawScalar("SELECT (SELECT out_port_id FROM BeltPath WHERE id=1) = (SELECT in_port_id FROM BeltPath WHERE id=3)"), 1);
    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE id=1 AND length=(2*2-1)"), 1);
    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE id=3 AND length=(2*2-1)"), 1);
});

test("Spans a reversed tunnel across a chunk boundary", async () => {
    const game = await setup();
    createBelt(game, GameObject.RAMP_UP, {x: 1, y: 1, direction: Direction.RIGHT});
    createBelt(game, GameObject.RAMP_DOWN, {x: -2, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    assert.equal(game.rawScalar("SELECT (SELECT out_port_id FROM BeltPath WHERE id=4) = (SELECT in_port_id FROM BeltPath WHERE id=3)"), 1);
    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE id=4 AND length=(2*2-1)"), 1);
    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE id=3 AND length=(2*2-1)"), 1);
});

test("Connects a belt into a down ramp", async () => {
    const game = await setup();
    createBelt(game, GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    createBelt(game, GameObject.RAMP_DOWN, {x: 1, y: 0, direction: Direction.RIGHT});
    createBelt(game, GameObject.BELT, {x: 2, y: 0, direction: Direction.RIGHT});

    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE id=1 AND length=(2*2-1)"), 1);
    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE id=3 AND length=1"), 1);
});

test("Connects a belt out of an up ramp", async () => {
    const game = await setup();
    createBelt(game, GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    createBelt(game, GameObject.RAMP_UP, {x: 1, y: 0, direction: Direction.RIGHT});
    createBelt(game, GameObject.BELT, {x: 2, y: 0, direction: Direction.RIGHT});

    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE id=1 AND length=1"), 1);
    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE id=2 AND length=(2*2-1)"), 1);
});

test("Connects ramps only in matching orientations", async () => {
    const game = await setup();

    createBelt(game, GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    createBelt(game, GameObject.RAMP_UP, {x: 1, y: 0, direction: Direction.UP});

    createBelt(game, GameObject.BELT, {x: 0, y: 2, direction: Direction.RIGHT});
    createBelt(game, GameObject.RAMP_UP, {x: 1, y: 2, direction: Direction.DOWN});

    createBelt(game, GameObject.BELT, {x: 0, y: 4, direction: Direction.RIGHT});
    createBelt(game, GameObject.RAMP_DOWN, {x: 1, y: 4, direction: Direction.UP});

    createBelt(game, GameObject.BELT, {x: 0, y: 6, direction: Direction.RIGHT});
    createBelt(game, GameObject.RAMP_DOWN, {x: 1, y: 6, direction: Direction.DOWN});

    createBelt(game, GameObject.RAMP_UP, {x: 1, y: 24, direction: Direction.UP});
    createBelt(game, GameObject.BELT, {x: 0, y: 24, direction: Direction.RIGHT});

    createBelt(game, GameObject.RAMP_UP, {x: 1, y: 26, direction: Direction.DOWN});
    createBelt(game, GameObject.BELT, {x: 0, y: 26, direction: Direction.RIGHT});

    createBelt(game, GameObject.RAMP_DOWN, {x: 1, y: 28, direction: Direction.UP});
    createBelt(game, GameObject.BELT, {x: 0, y: 28, direction: Direction.RIGHT});

    createBelt(game, GameObject.RAMP_DOWN, {x: 1, y: 30, direction: Direction.DOWN});
    createBelt(game, GameObject.BELT, {x: 0, y: 30, direction: Direction.RIGHT});

    createBelt(game, GameObject.BELT, {x: 1, y: 12, direction: Direction.UP});
    createBelt(game, GameObject.RAMP_DOWN, {x: 0, y: 12, direction: Direction.RIGHT});

    createBelt(game, GameObject.BELT, {x: 1, y: 14, direction: Direction.DOWN});
    createBelt(game, GameObject.RAMP_DOWN, {x: 0, y: 14, direction: Direction.RIGHT});

    createBelt(game, GameObject.RAMP_DOWN, {x: 0, y: 20, direction: Direction.RIGHT});
    createBelt(game, GameObject.BELT, {x: 1, y: 20, direction: Direction.UP});

    createBelt(game, GameObject.RAMP_DOWN, {x: 0, y: 22, direction: Direction.RIGHT});
    createBelt(game, GameObject.BELT, {x: 1, y: 22, direction: Direction.DOWN});

    assert.equal(game.rawScalar("SELECT COUNT(*) FROM BeltPath WHERE length=1"), 24);

    createBelt(game, GameObject.RAMP_UP, {x: 0, y: 16, direction: Direction.RIGHT});
    createBelt(game, GameObject.BELT, {x: 1, y: 16, direction: Direction.UP});

    createBelt(game, GameObject.RAMP_UP, {x: 0, y: 18, direction: Direction.RIGHT});
    createBelt(game, GameObject.BELT, {x: 1, y: 18, direction: Direction.DOWN});

    assert.equal(game.rawScalar("SELECT COUNT(*) FROM BeltPath WHERE length=(2*2-1)"), 2);

    createBelt(game, GameObject.BELT, {x: 1, y: 10, direction: Direction.DOWN});
    createBelt(game, GameObject.RAMP_UP, {x: 0, y: 10, direction: Direction.RIGHT});

    assert.equal(game.rawScalar("SELECT COUNT(*) FROM BeltPath WHERE length=(2*2-1)"), 3);

    createBelt(game, GameObject.BELT, {x: 1, y: 8, direction: Direction.UP});
    createBelt(game, GameObject.RAMP_UP, {x: 0, y: 8, direction: Direction.RIGHT});

    assert.equal(game.rawScalar("SELECT COUNT(*) FROM BeltPath WHERE length=(2*2-1)"), 4);
});

test("Disconnects an existing ramp pair when a ramp is reused and rejects invalid disconnects", async () => {
    const game = await setup();

    createBelt(game, GameObject.RAMP_DOWN, {x: 0, y: 0, direction: Direction.RIGHT});
    createBelt(game, GameObject.RAMP_UP, {x: 3, y: 0, direction: Direction.RIGHT, rampParent: 1n});

    assert.equal(game.rawScalar(`SELECT COUNT(*) FROM Belt WHERE type=${BeltType.UNDERGROUND}`), 2);

    createBelt(game, GameObject.RAMP_UP, {x: 1, y: 0, direction: Direction.RIGHT, rampParent: 1n});
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM Belt"), 4);

    assert.throws(() => {
        createBelt(game, GameObject.RAMP_UP, {x: 1, y: 0, direction: Direction.RIGHT, rampParent: 1n, disconnectRampChild: 1n});
    });
    assert.throws(() => {
        createBelt(game, GameObject.RAMP_UP, {x: 1, y: 0, direction: Direction.RIGHT, disconnectRampChild: 1n});
    });
    assert.throws(() => {
        createBelt(game, GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT, rampParent: 1n, disconnectRampChild: 4n});
    });

    createBelt(game, GameObject.RAMP_UP, {x: 1, y: 0, direction: Direction.RIGHT, rampParent: 1n, disconnectRampChild: 4n});

    assert.equal(game.rawScalar(`SELECT COUNT(*) FROM Belt WHERE type=${BeltType.UNDERGROUND}`), 0);
});

test("Ignores deleting a belt that does not exist", async () => {
    const game = await setup();
    createBelt(game, GameObject.BELT, {x: 0, y: 0, direction: Direction.UP});
    deleteBelt(game, 1n);
    deleteBelt(game, 1n);
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM Belt"), 0);
});

test("Ignores creating a belt over an existing one", async () => {
    const game = await setup();
    createBelt(game, GameObject.BELT, {x: 0, y: 0, direction: Direction.UP});
    createBelt(game, GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM Belt WHERE x=0 AND y=0"), 1);
});

test("Disconnects a ramp pair across a chunk boundary", async () => {
    const game = await setup();
    createBelt(game, GameObject.RAMP_DOWN, {x: -2, y: 0, direction: Direction.RIGHT});
    createBelt(game, GameObject.RAMP_UP, {x: 2, y: 0, direction: Direction.RIGHT, rampParent: 1n});

    assert.equal(game.rawScalar(`SELECT COUNT(*) FROM Belt WHERE type=${BeltType.UNDERGROUND}`), 3);

    createBelt(game, GameObject.RAMP_UP, {x: 1, y: 0, direction: Direction.RIGHT, rampParent: 1n, disconnectRampChild: 5n});

    assert.equal(game.rawScalar(`SELECT COUNT(*) FROM Belt WHERE type=${BeltType.UNDERGROUND}`), 2);
});

test("Collapses a multi-segment tunnel when the up ramp is deleted", async () => {
    const game = await setup();
    createBelt(game, GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT});
    createBelt(game, GameObject.RAMP_UP, {x: 4, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    deleteBelt(game, 4n);

    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE id=1 AND length=1"), 1);
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM Belt"), 1);
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM BeltPath"), 1);
});

test("Rejoins an upstream belt when the up ramp is deleted", async () => {
    const game = await setup();
    // BELT_NORMAL(0,1)→ RAMP_DOWN(1,1)→ UG(2,1) UG(3,1) RAMP_UP(4,1)
    // ids: BN=1, RAMP_DOWN=2, UG1=3, UG2=4, RAMP_UP=5
    createBelt(game, GameObject.BELT, {x: 0, y: 1, direction: Direction.RIGHT});
    createBelt(game, GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT});
    createBelt(game, GameObject.RAMP_UP, {x: 4, y: 1, direction: Direction.RIGHT, rampParent: 2n});

    deleteBelt(game, 5n);

    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE id=1 AND length=3"), 1);
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM Belt"), 2);
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM BeltPath"), 1);
});

test("Rejects manually deleting a tunnel segment without changing state", async () => {
    const game = await setup();
    // RAMP_DOWN(1,1)→ UG(2,1) UG(3,1) → RAMP_UP(4,1). ids: ramp_down=1, ug=2,3, ramp_up=4
    createBelt(game, GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT});
    createBelt(game, GameObject.RAMP_UP, {x: 4, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    // Park an item on the path's output port so a faulty (commit-then-throw) delete
    // would be observable as a cleared port and/or a stranded StashedOutputItem row.
    game.rawExec("UPDATE Port SET item=7 WHERE id=(SELECT out_port_id FROM BeltPath WHERE id=1)");

    // Manually deleting a tunnel segment must be rejected...
    assert.throws(() => deleteBelt(game, 2n));

    // ...and must leave all state untouched (no partial commit).
    assert.equal(game.rawScalar("SELECT item FROM Port WHERE id=(SELECT out_port_id FROM BeltPath WHERE id=1)"), 7);
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM StashedOutputItem"), 0);
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM Belt"), 4);
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM BeltPath"), 1);
});

test("Spans a downward tunnel through ramps", async () => {
    const game = await setup();
    createBelt(game, GameObject.RAMP_DOWN, {x: 1, y: 0, direction: Direction.DOWN});
    createBelt(game, GameObject.RAMP_UP, {x: 1, y: 3, direction: Direction.DOWN, rampParent: 1n});

    assert.equal(game.rawScalar("SELECT 1 FROM BeltPath WHERE id=1 AND length=(4*2-1)"), 1);
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM Belt"), 4);
});

test("Rejects a diagonal ramp parent for an underground", async () => {
    const game = await setup();
    createBelt(game, GameObject.RAMP_DOWN, {x: 0, y: 0, direction: Direction.RIGHT});

    // The up ramp shares neither x nor y with its claimed ramp parent.
    assert.throws(() => {
        createBelt(game, GameObject.RAMP_UP, {x: 2, y: 2, direction: Direction.RIGHT, rampParent: 1n});
    });
});

test("Rejects disconnecting a ramp beyond the maximum tunnel length", async () => {
    const game = await setup();
    createBelt(game, GameObject.RAMP_DOWN, {x: 0, y: 0, direction: Direction.RIGHT});

    // The reused ramp sits farther than a tunnel could ever span.
    assert.throws(() => {
        createBelt(game, GameObject.RAMP_DOWN, {
            x: MAX_UNDERGROUND_LENGTH + 3,
            y: 0,
            direction: Direction.RIGHT,
            rampParent: 1n,
            disconnectRampChild: 1n,
        });
    });
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM Belt"), 1);
});

test("Disconnects a down-ramp tunnel when a down ramp is reused", async () => {
    const game = await setup();
    createBelt(game, GameObject.RAMP_UP, {x: 3, y: 0, direction: Direction.RIGHT});
    createBelt(game, GameObject.RAMP_DOWN, {x: 0, y: 0, direction: Direction.RIGHT, rampParent: 1n});

    assert.equal(game.rawScalar(`SELECT COUNT(*) FROM Belt WHERE type=${BeltType.UNDERGROUND}`), 2);

    createBelt(game, GameObject.RAMP_DOWN, {x: 2, y: 0, direction: Direction.RIGHT, rampParent: 1n, disconnectRampChild: 4n});

    assert.equal(game.rawScalar(`SELECT COUNT(*) FROM Belt WHERE type=${BeltType.UNDERGROUND}`), 0);
});

test("Deletes the down ramp of a looped tunnel without corrupting paths", async () => {
    const game = await setup();
    // A loop whose top edge is a 1-underground tunnel:
    // (0,0)→[RAMP_DOWN(1,0) UG(2,0) RAMP_UP(3,0)]→(4,0)→(4,1)→(3,1)→(2,1)→(1,1)→(0,1)→(0,0)
    // ids: belt=1, ramp_down=2, ug=3, ramp_up=4, then 5..10 around the loop.
    createBelt(game, GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    createBelt(game, GameObject.RAMP_DOWN, {x: 1, y: 0, direction: Direction.RIGHT});
    createBelt(game, GameObject.RAMP_UP, {x: 3, y: 0, direction: Direction.RIGHT, rampParent: 2n});
    createBelt(game, GameObject.BELT, {x: 4, y: 0, direction: Direction.DOWN});
    createBelt(game, GameObject.BELT, {x: 4, y: 1, direction: Direction.LEFT});
    createBelt(game, GameObject.BELT, {x: 3, y: 1, direction: Direction.LEFT});
    createBelt(game, GameObject.BELT, {x: 2, y: 1, direction: Direction.LEFT});
    createBelt(game, GameObject.BELT, {x: 1, y: 1, direction: Direction.LEFT});
    createBelt(game, GameObject.BELT, {x: 0, y: 1, direction: Direction.UP});

    // Deleting the down ramp removes the tunnel and breaks the loop; the seam
    // (the belt whose parent was nulled) must re-link so the remainder stays a
    // consistent, connected run instead of crashing on the tail_id constraint.
    assert.doesNotThrow(() => deleteBelt(game, 2n));

    assert.equal(game.rawScalar("SELECT COUNT(*) FROM Belt"), 8);
    // No path may be left with a dangling (null) tail.
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM BeltPath WHERE tail_id IS NULL"), 0);

    // The eight remaining belts form one open run; an item entering its head must
    // reach its tail (i.e. cross the former loop seam).
    const headPort = game.rawScalar(`
        SELECT p.in_port_id
        FROM BeltPath p
            LEFT JOIN BeltPath upstream ON upstream.out_port_id = p.in_port_id
        WHERE upstream.id IS NULL AND p.in_port_id IS NOT NULL
    `);
    const tailPort = game.rawScalar(`
        SELECT p.out_port_id
        FROM BeltPath p
            LEFT JOIN BeltPath downstream ON downstream.in_port_id = p.out_port_id
        WHERE downstream.id IS NULL AND p.out_port_id IS NOT NULL
    `);
    game.rawExec(`UPDATE Port SET item=1 WHERE id=${headPort}`);
    let arrived = false;
    for (let tick = 0; tick < 40 && !arrived; tick++) {
        game.tickAll();
        arrived = game.rawScalar(`SELECT item FROM Port WHERE id=${tailPort}`) === 1;
    }
    assert.ok(arrived, "item never reached the tail of the broken-loop run");
});

test("Drops overflow items instead of crashing when a belt is deleted from a full line", async () => {
    const game = await setup();
    for (let x = 0; x < 6; x++) {
        createBelt(game, GameObject.BELT, {x, y: 0, direction: Direction.RIGHT});
    }

    // Pack the line solid: feed items while the output stays blocked.
    const inPort = game.rawScalar("SELECT in_port_id FROM BeltPath");
    const outPort = game.rawScalar("SELECT out_port_id FROM BeltPath");
    for (let tick = 0; tick < 30; tick++) {
        game.rawExec(`UPDATE Port SET item=1 WHERE id=${inPort} AND item IS NULL`);
        game.rawExec(`UPDATE Port SET item=1 WHERE id=${outPort}`);
        game.tickAll();
    }
    assert.equal(game.rawScalar("SELECT head_gap FROM BeltPath"), 0);

    // Deleting a belt shortens capacity; the items that no longer fit are dropped
    // rather than violating the head_gap <= length constraint.
    assert.doesNotThrow(() => deleteBelt(game, 3n));
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM BeltPath WHERE head_gap < 0 OR head_gap > length"), 0);
    assert.ok(game.rawScalar("SELECT COUNT(*) FROM BeltPathItem WHERE type != 0") > 0);
});

test("Drops overflow items instead of crashing when a belt is deleted from a full loop", async () => {
    const game = await buildRing3x3();

    // The disconnected seam dead-ends the output, so feeding fills the ring solid.
    const inPort = game.rawScalar("SELECT in_port_id FROM BeltPath");
    for (let tick = 0; tick < 40; tick++) {
        game.rawExec(`UPDATE Port SET item=1 WHERE id=${inPort} AND item IS NULL`);
        game.tickAll();
    }
    assert.equal(game.rawScalar("SELECT head_gap FROM BeltPath"), 0);

    assert.doesNotThrow(() => deleteBelt(game, 5n));
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM BeltPath WHERE head_gap < 0 OR head_gap > length"), 0);
    assert.ok(game.rawScalar("SELECT COUNT(*) FROM BeltPathItem WHERE type != 0") > 0);
});

test("Trims overflow from the head and keeps the item furthest from it", async () => {
    const game = await buildRing3x3();

    // Pack the ring solid with distinctly-typed items so individual items are
    // identifiable; the disconnected seam dead-ends the output so nothing drains.
    const inPort = game.rawScalar("SELECT in_port_id FROM BeltPath");
    for (let tick = 0; tick < 40; tick++) {
        game.rawExec(`UPDATE Port SET item=${tick + 2} WHERE id=${inPort} AND item IS NULL`);
        game.tickAll();
    }
    assert.equal(game.rawScalar("SELECT head_gap FROM BeltPath"), 0);

    // The lowest-id item is at the front of the run (furthest from the head, first to
    // leave); a correct overflow trim removes head-most items, so this one must survive.
    const frontItemType = game.rawScalar("SELECT type FROM BeltPathItem WHERE type != 0 ORDER BY id ASC LIMIT 1");

    // Deleting a belt shortens the run below the packed item count, forcing a trim.
    // Regression: TrimOverflowItems must accumulate from the tail (ORDER BY id ASC) and
    // drop the head-most items; the buggy id-DESC form drops this front item instead.
    deleteBelt(game, 5n);

    assert.equal(game.rawScalar("SELECT COUNT(*) FROM BeltPath WHERE head_gap < 0 OR head_gap > length"), 0);
    assert.equal(game.rawScalar(`SELECT COUNT(*) FROM BeltPathItem WHERE type=${frontItemType}`), 1);
});

test("Absorbs a boundary gap into head_gap instead of leaving it at the head", async () => {
    const game = await setup();
    for (let x = 0; x < 3; x++) {
        createBelt(game, GameObject.BELT, {x, y: 0, direction: Direction.RIGHT});
    }

    // Craft an overflowing layout (total 6 > path length 5) whose single gap sits
    // exactly at the capacity boundary: tail-> item,item,item,item,gap,item <-head.
    // Trimming the overflow item would leave the gap as the head-most row unless it is
    // normalized away; empty space at the head must live in head_gap so a new item can
    // still enter. (This crafts the layout directly to exercise TrimOverflowItems —
    // the normal stash/unstash pipeline does not place a gap on the boundary.)
    game.rawExec("DELETE FROM BeltPathItem WHERE path_id=1");
    game.rawExec(`INSERT INTO BeltPathItem (path_id, type, length) VALUES
        (1, 2, 1), (1, 3, 1), (1, 4, 1), (1, 5, 1), (1, 0, 1), (1, 6, 1)`);

    game.queryScalar("TrimOverflowItems", {id: 1n});
    game.exec("DropTrailingHeadGaps", {id: 1n});
    game.exec("FillHeadGap", {id: 1n});

    // The head-most row must be a real item, not a gap, ...
    assert.notEqual(game.rawScalar("SELECT type FROM BeltPathItem WHERE path_id=1 ORDER BY id DESC LIMIT 1"), 0);
    // ... and the freed boundary space is reflected in head_gap so items can still enter.
    assert.ok(game.rawScalar("SELECT head_gap FROM BeltPath WHERE id=1") > 0);
});
