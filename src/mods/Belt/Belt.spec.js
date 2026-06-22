
import {test} from "node:test";
import assert from "node:assert/strict";
import {setup, GameObject} from "@/test/common.js";
import {BeltType, MAX_UNDERGROUND_LENGTH} from "@/mods/Belt/mod.js";
import {Direction} from "@/common/constants.js";

test("sets each belt's parent to the belt it flows into", async () => {
    const game = await setup();

    game.createBelt(GameObject.BELT, {x: 0, y: 0, direction: Direction.UP});
    game.createBelt(GameObject.BELT, {x: 0, y: -1, direction: Direction.RIGHT});
    game.createBelt(GameObject.BELT, {x: 0, y: 1, direction: Direction.UP});

    assert.equal(game.exec("SELECT parent_id FROM Belt WHERE id=1"), 3);
    assert.equal(game.exec("SELECT parent_id FROM Belt WHERE id=2"), 1);

    game.createBelt(GameObject.BELT, {x: 1, y: 1, direction: Direction.LEFT});
    assert.equal(game.exec("SELECT parent_id FROM Belt WHERE id=3"), 4);

    game.createBelt(GameObject.BELT, {x: -1, y: 0, direction: Direction.RIGHT});
    assert.equal(game.exec("SELECT parent_id FROM Belt WHERE id=1"), 5);

    game.createBelt(GameObject.BELT, {x: 1, y: 0, direction: Direction.LEFT});
    assert.equal(game.exec("SELECT parent_id FROM Belt WHERE id=1"), 6);
});

test("builds BeltPaths with correct length and tail across straight runs", async () => {
    const game = await setup();
    game.createBelt(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    game.createBelt(GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});
    game.createBelt(GameObject.BELT, {x: 2, y: 0, direction: Direction.RIGHT});

    assert.equal(game.exec("SELECT length=(3*2-1) AND id=1 AND tail_id=3 FROM BeltPath"), 1);

    game.createBelt(GameObject.BELT, {x: 1, y: 2, direction: Direction.UP});
    game.createBelt(GameObject.BELT, {x: 1, y: 1, direction: Direction.UP});

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE length=(4*2-1) AND id=4 AND tail_id=3"), 1);
    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE length=1 AND id=1 AND tail_id=1"), 1);
    assert.equal(game.exec("SELECT Count(*) FROM Port"), 4);
});

test("moves the output item to the tail path when a branch splits a run", async () => {
    const game = await setup();
    game.createBelt(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    game.createBelt(GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});
    game.createBelt(GameObject.BELT, {x: 2, y: 0, direction: Direction.RIGHT});

    game._db.db.exec("UPDATE Port SET item=2 WHERE id=(SELECT out_port_id FROM BeltPath WHERE id=1)");

    game.createBelt(GameObject.BELT, {x: 1, y: 1, direction: Direction.UP});

    assert.equal(game.exec("SELECT 1 FROM BeltPath INNER JOIN Port ON port.id=out_port_id WHERE BeltPath.id=1 AND item IS NULL"), 1);
    assert.equal(game.exec("SELECT 1 FROM BeltPath INNER JOIN Port ON port.id=out_port_id WHERE BeltPath.id=4 AND item=2"), 1);
    assert.equal(game.exec("SELECT Count(*) FROM Port"), 4);
});

test("keeps the output item when a belt is prepended to a run", async () => {
    const game = await setup();
    game.createBelt(GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});

    game._db.db.exec("UPDATE Port SET item=2 WHERE id=(SELECT out_port_id FROM BeltPath WHERE id=1)");

    game.createBelt(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});

    assert.equal(game.exec("SELECT 1 FROM BeltPath INNER JOIN Port ON port.id=out_port_id WHERE BeltPath.id=2 AND item=2"), 1);
    assert.equal(game.exec("SELECT Count(*) FROM Port"), 2);
});

test("retains an in-flight item when a belt is prepended", async () => {
    const game = await setup();
    game.createBelt(GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});

    game._db.db.exec("UPDATE Port SET item=1 WHERE id=(SELECT in_port_id FROM BeltPath WHERE id=1)");
    game.tickBeltPath();

    game.createBelt(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=2 AND next_item_id IS NOT NULL"), 1);
    assert.equal(game.exec("SELECT 1 FROM BeltPath INNER JOIN Port ON port.id=in_port_id WHERE BeltPath.id=2 AND item IS NULL"), 1);
});

test("forms a closed loop into a single path with no parent", async () => {
    const game = await setup();
    game.createBelt(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    game.createBelt(GameObject.BELT, {x: 1, y: 0, direction: Direction.DOWN});
    game.createBelt(GameObject.BELT, {x: 1, y: 1, direction: Direction.LEFT});
    game.createBelt(GameObject.BELT, {x: 0, y: 1, direction: Direction.UP});

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE length=(4*2-1) AND id=1 AND tail_id=4"), 1);
    assert.equal(game.exec("SELECT parent_id FROM Belt WHERE id=1"), null);
});

test("shares ports between belts that link head-to-tail", async () => {
    const game = await setup();
    game.createBelt(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    game.createBelt(GameObject.BELT, {x: -1, y: 0, direction: Direction.RIGHT});
    assert.equal(game.exec("SELECT (SELECT in_port_id FROM BeltPath WHERE id=1) = (SELECT out_port_id FROM BeltPath WHERE id=2)"), 1);

    game.createBelt(GameObject.BELT, {x: 0, y: -1, direction: Direction.DOWN});
    assert.equal(game.exec("SELECT (SELECT in_port_id FROM BeltPath WHERE id=1) = (SELECT out_port_id FROM BeltPath WHERE id=3)"), 1);

    assert.equal(game.exec("SELECT COUNT(*) FROM Port"), 5);
});

test("leaves head_gap unchanged when the belt is empty", async () => {
    const game = await setup();
    game.createBelt(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    game.createBelt(GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});
    game.createBelt(GameObject.BELT, {x: 2, y: 0, direction: Direction.RIGHT});

    assert.equal(game.exec("SELECT head_gap FROM BeltPath WHERE id=1"), 3*2-1);

    game.tickBeltPath();

    assert.equal(game.exec("SELECT head_gap FROM BeltPath WHERE id=1"), 3*2-1);
});

test("advances a single item along the belt to its output", async () => {
    const game = await setup();
    game.createBelt(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    game.createBelt(GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});
    game.createBelt(GameObject.BELT, {x: 2, y: 0, direction: Direction.RIGHT});

    assert.equal(game.exec("SELECT head_gap FROM BeltPath WHERE id=1"), 3*2-1);

    game._db.db.exec("UPDATE Port SET item=1 WHERE id=(SELECT in_port_id FROM BeltPath WHERE id=1)");

    game.tickBeltPath();
    assert.equal(game.exec("SELECT head_gap FROM BeltPath WHERE id=1"), 0);

    game.tickBeltPath();
    assert.equal(game.exec("SELECT head_gap FROM BeltPath WHERE id=1"), 1);

    game.tickBeltPath();
    game.tickBeltPath();
    assert.equal(game.exec("SELECT head_gap FROM BeltPath WHERE id=1"), 3);
    game.tickBeltPath();
    game.tickBeltPath();
    assert.equal(game.exec("SELECT item FROM Port WHERE id=(SELECT out_port_id FROM BeltPath WHERE id=1)"), 1);
});

test("advances two spaced items and stalls them at a blocked output", async () => {
    const game = await setup();
    game.createBelt(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    game.createBelt(GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});
    game.createBelt(GameObject.BELT, {x: 2, y: 0, direction: Direction.RIGHT});

    assert.equal(game.exec("SELECT head_gap FROM BeltPath WHERE id=1"), 3*2-1);

    game._db.db.exec("UPDATE Port SET item=1 WHERE id=(SELECT in_port_id FROM BeltPath WHERE id=1)");
    game.tickBeltPath();
    game.tickBeltPath();
    game._db.db.exec("UPDATE Port SET item=1 WHERE id=(SELECT in_port_id FROM BeltPath WHERE id=1)");
    game.tickBeltPath();

    assert.equal(game.exec("SELECT head_gap FROM BeltPath WHERE id=1"), 0);

    game.tickBeltPath();
    game.tickBeltPath();
    assert.equal(game.exec("SELECT head_gap FROM BeltPath WHERE id=1"), 2);
    game.tickBeltPath();
    assert.equal(game.exec("SELECT item FROM Port WHERE id=(SELECT out_port_id FROM BeltPath WHERE id=1)"), 1);

    game.tickBeltPath();
    assert.equal(game.exec("SELECT head_gap FROM BeltPath WHERE id=1"), 4);

    game._db.db.exec("UPDATE Port SET item=NULL WHERE id=(SELECT out_port_id FROM BeltPath WHERE id=1)");
    game.tickBeltPath();
    assert.equal(game.exec("SELECT head_gap FROM BeltPath WHERE id=1"), 5);
    assert.equal(game.exec("SELECT item FROM Port WHERE id=(SELECT out_port_id FROM BeltPath WHERE id=1)"), 1);
});

test("stashes items when the tail belt is deleted", async () => {
    const game = await setup();
    game.createBelt(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    game.createBelt(GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});
    game.createBelt(GameObject.BELT, {x: 2, y: 0, direction: Direction.RIGHT});

    game._db.db.exec("UPDATE Port SET item=1 WHERE id=(SELECT in_port_id FROM BeltPath WHERE id=1)");
    game._db.db.exec("UPDATE Port SET item=2 WHERE id=(SELECT out_port_id FROM BeltPath WHERE id=1)");
    game.tickBeltPath();

    game.removeGameObject(GameObject.BELT, 3n);

    assert.equal(game.exec("SELECT 1 FROM Port WHERE id=(SELECT out_port_id FROM BeltPath WHERE id=1) AND item IS NULL"), 1);
    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=1 AND next_gap_id=3 AND next_item_id=4"), 1);
    assert.equal(game.exec("SELECT 1 FROM BeltPathItem WHERE id=3 AND length=2"), 1);
});

test("splits the path and stashes items when a middle belt is deleted", async () => {
    const game = await setup();
    game.createBelt(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    game.createBelt(GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});
    game.createBelt(GameObject.BELT, {x: 2, y: 0, direction: Direction.RIGHT});

    game._db.db.exec("UPDATE Port SET item=1 WHERE id=(SELECT in_port_id FROM BeltPath WHERE id=1)");
    game._db.db.exec("UPDATE Port SET item=2 WHERE id=(SELECT out_port_id FROM BeltPath WHERE id=1)");
    game.tickBeltPath();

    game.removeGameObject(GameObject.BELT, 2n);

    assert.equal(game.exec("SELECT 1 FROM Port WHERE id=(SELECT out_port_id FROM BeltPath WHERE id=1) AND item IS NULL"), 1);
    assert.equal(game.exec("SELECT 1 FROM Port WHERE id=(SELECT out_port_id FROM BeltPath WHERE id=3) AND item=2"), 1);

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=1 AND head_gap=0 AND next_gap_id IS NULL AND next_item_id IS NOT NULL"), 1);
    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=3 AND head_gap=1 AND next_gap_id IS NULL AND next_item_id IS NULL"), 1);
});

test("keeps downstream items when the head belt is deleted", async () => {
    const game = await setup();
    game.createBelt(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    game.createBelt(GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});
    game.createBelt(GameObject.BELT, {x: 2, y: 0, direction: Direction.RIGHT});

    game._db.db.exec("UPDATE Port SET item=1 WHERE id=(SELECT in_port_id FROM BeltPath WHERE id=1)");
    game._db.db.exec("UPDATE Port SET item=2 WHERE id=(SELECT out_port_id FROM BeltPath WHERE id=1)");
    game.tickBeltPath();

    game.removeGameObject(GameObject.BELT, 1n);

    assert.equal(game.exec("SELECT 1 FROM Port WHERE id=(SELECT out_port_id FROM BeltPath WHERE id=2) AND item=2"), 1);
    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=2 AND head_gap=(2*2-1) AND next_gap_id IS NULL AND next_item_id IS NULL"), 1);
});

test("keeps a waiting item in place when the path is extended", async () => {
    const game = await setup();
    game.createBelt(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    game.createBelt(GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=1 AND head_gap=(2*2-1)"), 1);

    game._db.db.exec("UPDATE Port SET item=1 WHERE id=(SELECT in_port_id FROM BeltPath WHERE id=1)");
    game.tickBeltPath();

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=1 AND head_gap=0"), 1);

    game.createBelt(GameObject.BELT, {x: 2, y: 0, direction: Direction.RIGHT});

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=1 AND head_gap=0"), 1);
});

test("cleans up shared ports when the child belt is deleted", async () => {
    const game = await setup();
    game.createBelt(GameObject.BELT, {x: -1, y: 0, direction: Direction.RIGHT});
    game.createBelt(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});

    assert.equal(game.exec("SELECT (SELECT out_port_id FROM BeltPath WHERE id=1) = (SELECT in_port_id FROM BeltPath WHERE id=2)"), 1);
    assert.equal(game.exec("SELECT COUNT(*) FROM Port"), 3);

    game.removeGameObject(GameObject.BELT, 2n);

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE in_port_id IS NULL OR out_port_id IS NULL"), undefined);
    assert.equal(game.exec("SELECT COUNT(*) FROM Port"), 2);
});

test("cleans up shared ports when the parent belt is deleted", async () => {
    const game = await setup();
    game.createBelt(GameObject.BELT, {x: -1, y: 0, direction: Direction.RIGHT});
    game.createBelt(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});

    assert.equal(game.exec("SELECT (SELECT out_port_id FROM BeltPath WHERE id=1) = (SELECT in_port_id FROM BeltPath WHERE id=2)"), 1);

    game.removeGameObject(GameObject.BELT, 1n);

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE in_port_id IS NULL OR out_port_id IS NULL"), undefined);
    assert.equal(game.exec("SELECT COUNT(*) FROM Port"), 2);
});

test("spans an upward tunnel with one BeltPath through ramps", async () => {
    const game = await setup();
    game.createBelt(GameObject.BELT, {x: 0, y: 10, direction: Direction.RIGHT});
    game.createBelt(GameObject.BELT, {x: 1, y: 10, direction: Direction.RIGHT});
    game.createBelt(GameObject.BELT, {x: 2, y: 10, direction: Direction.RIGHT});

    game.createBelt(GameObject.BELT, {x: 1, y: 12, direction: Direction.UP});
    game.createBelt(GameObject.RAMP_DOWN, {x: 1, y: 11, direction: Direction.UP});
    game.createBelt(GameObject.RAMP_UP, {x: 1, y: 9, direction: Direction.UP, rampParent: 5n});
    game.createBelt(GameObject.BELT, {x: 1, y: 8, direction: Direction.UP});

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=1 AND length=(3*2-1)"), 1);
    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=4 AND length=(5*2-1)"), 1);
});

test("connects adjacent ramps with zero gap", async () => {
    const game = await setup();
    game.createBelt(GameObject.RAMP_DOWN, {x: 1, y: 10, direction: Direction.UP});
    game.createBelt(GameObject.RAMP_UP, {x: 1, y: 9, direction: Direction.UP, rampParent: 1n});

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=1 AND length=(2*2-1)"), 1);
});

test("connects adjacent reversed ramps with zero gap", async () => {
    const game = await setup();
    game.createBelt(GameObject.RAMP_UP, {x: 1, y: 0, direction: Direction.LEFT});
    game.createBelt(GameObject.RAMP_DOWN, {x: 2, y: 0, direction: Direction.LEFT, rampParent: 1n});

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=2 AND length=(2*2-1)"), 1);
});

test("spans a leftward tunnel with one BeltPath through ramps", async () => {
    const game = await setup();
    game.createBelt(GameObject.BELT, {x: 10, y: 0, direction: Direction.DOWN});
    game.createBelt(GameObject.BELT, {x: 10, y: 1, direction: Direction.DOWN});
    game.createBelt(GameObject.BELT, {x: 10, y: 2, direction: Direction.DOWN});

    game.createBelt(GameObject.BELT, {x: 12, y: 1, direction: Direction.LEFT});
    game.createBelt(GameObject.RAMP_DOWN, {x: 11, y: 1, direction: Direction.LEFT});
    game.createBelt(GameObject.RAMP_UP, {x: 9, y: 1, direction: Direction.LEFT, rampParent: 5n});
    game.createBelt(GameObject.BELT, {x: 8, y: 1, direction: Direction.LEFT});

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=1 AND length=(3*2-1)"), 1);
    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=4 AND length=(5*2-1)"), 1);
});

test("connects ramps at the maximum tunnel length", async () => {
    const game = await setup();
    game.createBelt(GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT});
    game.createBelt(GameObject.RAMP_UP, {x: 1 + MAX_UNDERGROUND_LENGTH + 1, y: 1, direction: Direction.RIGHT, rampParent: 1n});
    assert.equal(game.exec(`SELECT 1 FROM BeltPath WHERE id=1 AND length=${(MAX_UNDERGROUND_LENGTH + 2)*2-1}`), 1);
});

test("connects ramps placed in reverse at the maximum tunnel length", async () => {
    const game = await setup();
    game.createBelt(GameObject.RAMP_UP, {x: 1 + MAX_UNDERGROUND_LENGTH + 1, y: 1, direction: Direction.RIGHT});
    game.createBelt(GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    assert.equal(game.exec(`SELECT 1 FROM BeltPath WHERE id=${MAX_UNDERGROUND_LENGTH + 2} AND length=${(MAX_UNDERGROUND_LENGTH + 2)*2-1}`), 1);
    assert.equal(game.exec("SELECT COUNT(*) FROM BeltPath"), 1);
});

test("does not connect ramps beyond the maximum tunnel length", async () => {
    const game = await setup();
    game.createBelt(GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT});
    game.createBelt(GameObject.RAMP_UP, {x: 1 + MAX_UNDERGROUND_LENGTH + 2, y: 1, direction: Direction.RIGHT, rampParent: 1n});
    assert.equal(game.exec(`SELECT 1 FROM BeltPath WHERE id=1 AND length=${(MAX_UNDERGROUND_LENGTH + 3)*2-1}`), undefined);
});

test("leaves over-long reversed ramps unconnected", async () => {
    const game = await setup();
    game.createBelt(GameObject.RAMP_UP, {x: 1 + MAX_UNDERGROUND_LENGTH + 2, y: 1, direction: Direction.RIGHT});
    game.createBelt(GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    assert.equal(game.exec(`SELECT 1 FROM BeltPath WHERE id=${MAX_UNDERGROUND_LENGTH + 3} AND length=${(MAX_UNDERGROUND_LENGTH + 3)*2-1}`), undefined);
    assert.equal(game.exec("SELECT COUNT(*) FROM BeltPath"), 2);
});

test("collapses the tunnel when the up ramp is deleted", async () => {
    const game = await setup();
    game.createBelt(GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT});
    game.createBelt(GameObject.RAMP_UP, {x: 3, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    game.removeGameObject(GameObject.BELT, 3n);

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=1 AND length=1"), 1);
    assert.equal(game.exec("SELECT COUNT(*) FROM Belt"), 1);
    assert.equal(game.exec("SELECT COUNT(*) FROM BeltPath"), 1);
});

test("collapses the tunnel when the down ramp is deleted", async () => {
    const game = await setup();
    game.createBelt(GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT});
    game.createBelt(GameObject.RAMP_UP, {x: 3, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    game.removeGameObject(GameObject.BELT, 1n);

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=3 AND length=1"), 1);
    assert.equal(game.exec("SELECT COUNT(*) FROM Belt"), 1);
    assert.equal(game.exec("SELECT COUNT(*) FROM BeltPath"), 1);
});

test("stashes the tunnel item when the down ramp is deleted", async () => {
    const game = await setup();
    game.createBelt(GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT});
    game.createBelt(GameObject.RAMP_UP, {x: 3, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    game._db.db.exec("UPDATE Port SET item=1 WHERE id=(SELECT in_port_id FROM BeltPath WHERE id=1)");
    game.tickBeltPath();

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=1 AND length=(3*2-1) AND head_gap=0"), 1);

    game.removeGameObject(GameObject.BELT, 3n);

    assert.equal(game.exec("SELECT 1 FROM BeltPathItem WHERE path_id=1 AND type=1"), 1);
    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=1 AND length=1 AND head_gap=0"), 1);
    assert.equal(game.exec("SELECT COUNT(*) FROM Belt"), 1);
    assert.equal(game.exec("SELECT COUNT(*) FROM BeltPath"), 1);
});

test("leaves no stash when the down ramp is deleted after the item advances past the tunnel", async () => {
    const game = await setup();
    game.createBelt(GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT});
    game.createBelt(GameObject.RAMP_UP, {x: 3, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    game._db.db.exec("UPDATE Port SET item=1 WHERE id=(SELECT in_port_id FROM BeltPath WHERE id=1)");
    game.tickBeltPath();
    game.tickBeltPath();

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=1 AND length=(3*2-1) AND head_gap=1"), 1);

    game.removeGameObject(GameObject.BELT, 3n);

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=1 AND length=1 AND head_gap=1"), 1);
    assert.equal(game.exec("SELECT COUNT(*) FROM Belt"), 1);
    assert.equal(game.exec("SELECT COUNT(*) FROM BeltPath"), 1);
    assert.equal(game.exec("SELECT 1 FROM BeltPathItem"), undefined);
});

test("collapses a zero-gap tunnel when the down ramp is deleted", async () => {
    const game = await setup();
    game.createBelt(GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT});
    game.createBelt(GameObject.RAMP_UP, {x: 2, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    game.removeGameObject(GameObject.BELT, 1n);

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=2 AND length=1"), 1);
    assert.equal(game.exec("SELECT COUNT(*) FROM Belt"), 1);
    assert.equal(game.exec("SELECT COUNT(*) FROM BeltPath"), 1);
});

test("collapses a zero-gap tunnel when the up ramp is deleted", async () => {
    const game = await setup();
    game.createBelt(GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT});
    game.createBelt(GameObject.RAMP_UP, {x: 2, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    game.removeGameObject(GameObject.BELT, 2n);

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=1 AND length=1"), 1);
    assert.equal(game.exec("SELECT COUNT(*) FROM Belt"), 1);
    assert.equal(game.exec("SELECT COUNT(*) FROM BeltPath"), 1);
});

test("moves items through a zero-gap tunnel across a chunk boundary and collapses on delete", async () => {
    const game = await setup();
    game.createBelt(GameObject.RAMP_DOWN, {x: -1, y: 1, direction: Direction.RIGHT});
    game.createBelt(GameObject.RAMP_UP, {x: 0, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    assert.equal(game.exec("SELECT (SELECT out_port_id FROM BeltPath WHERE id=1) = (SELECT in_port_id FROM BeltPath WHERE id=2)"), 1);

    game._db.db.exec("UPDATE Port SET item=1 WHERE id=(SELECT in_port_id FROM BeltPath WHERE id=1)");
    game.tickBeltPath();
    game.tickBeltPath();

    assert.equal(game.exec("SELECT 1 FROM BeltPathItem WHERE path_id=2"), 1);
    game.tickBeltPath();
    assert.equal(game.exec("SELECT 1 FROM Port WHERE id=(SELECT out_port_id FROM BeltPath WHERE id=2) AND item=1"), 1);

    game.removeGameObject(GameObject.BELT, 1n);

    assert.equal(game.exec("SELECT (SELECT out_port_id FROM BeltPath WHERE id=1) = (SELECT in_port_id FROM BeltPath WHERE id=2)"), null);
    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE in_port_id IS NULL OR out_port_id IS NULL"), undefined);

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=2 AND length=1"), 1);
    assert.equal(game.exec("SELECT COUNT(*) FROM Belt"), 1);
    assert.equal(game.exec("SELECT COUNT(*) FROM BeltPath"), 1);
});

test("carries an item through a tunnel crossing a chunk boundary", async () => {
    const game = await setup();
    game.createBelt(GameObject.RAMP_DOWN, {x: -1, y: 1, direction: Direction.RIGHT});
    game.createBelt(GameObject.RAMP_UP, {x: 1, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    assert.equal(game.exec("SELECT (SELECT out_port_id FROM BeltPath WHERE id=1) = (SELECT in_port_id FROM BeltPath WHERE id=2)"), 1);
    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=1 AND length=1"), 1);
    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=2 AND length=(2*2-1)"), 1);

    game._db.db.exec("UPDATE Port SET item=1 WHERE id=(SELECT in_port_id FROM BeltPath WHERE id=1)");
    game.tickBeltPath();
    game.tickBeltPath();
    game.tickBeltPath();

    assert.equal(game.exec("SELECT 1 FROM BeltPathItem WHERE path_id=2"), 1);
});

test("spans a tunnel across a chunk boundary with correct lengths", async () => {
    const game = await setup();
    game.createBelt(GameObject.RAMP_DOWN, {x: -2, y: 1, direction: Direction.RIGHT});
    game.createBelt(GameObject.RAMP_UP, {x: 0, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    assert.equal(game.exec("SELECT (SELECT out_port_id FROM BeltPath WHERE id=1) = (SELECT in_port_id FROM BeltPath WHERE id=3)"), 1);
    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=1 AND length=(2*2-1)"), 1);
    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=3 AND length=1"), 1);
});

test("spans a longer tunnel across a chunk boundary", async () => {
    const game = await setup();
    game.createBelt(GameObject.RAMP_DOWN, {x: -2, y: 1, direction: Direction.RIGHT});
    game.createBelt(GameObject.RAMP_UP, {x: 1, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    assert.equal(game.exec("SELECT (SELECT out_port_id FROM BeltPath WHERE id=1) = (SELECT in_port_id FROM BeltPath WHERE id=3)"), 1);
    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=1 AND length=(2*2-1)"), 1);
    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=3 AND length=(2*2-1)"), 1);
});

test("spans a reversed tunnel across a chunk boundary", async () => {
    const game = await setup();
    game.createBelt(GameObject.RAMP_UP, {x: 1, y: 1, direction: Direction.RIGHT});
    game.createBelt(GameObject.RAMP_DOWN, {x: -2, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    assert.equal(game.exec("SELECT (SELECT out_port_id FROM BeltPath WHERE id=4) = (SELECT in_port_id FROM BeltPath WHERE id=3)"), 1);
    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=4 AND length=(2*2-1)"), 1);
    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=3 AND length=(2*2-1)"), 1);
});

test("connects a belt into a down ramp", async () => {
    const game = await setup();
    game.createBelt(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    game.createBelt(GameObject.RAMP_DOWN, {x: 1, y: 0, direction: Direction.RIGHT});
    game.createBelt(GameObject.BELT, {x: 2, y: 0, direction: Direction.RIGHT});

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=1 AND length=(2*2-1)"), 1);
    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=3 AND length=1"), 1);
});

test("connects a belt out of an up ramp", async () => {
    const game = await setup();
    game.createBelt(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    game.createBelt(GameObject.RAMP_UP, {x: 1, y: 0, direction: Direction.RIGHT});
    game.createBelt(GameObject.BELT, {x: 2, y: 0, direction: Direction.RIGHT});

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=1 AND length=1"), 1);
    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=2 AND length=(2*2-1)"), 1);
});

test("connects ramps only in matching orientations", async () => {
    const game = await setup();

    game.createBelt(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    game.createBelt(GameObject.RAMP_UP, {x: 1, y: 0, direction: Direction.UP});

    game.createBelt(GameObject.BELT, {x: 0, y: 2, direction: Direction.RIGHT});
    game.createBelt(GameObject.RAMP_UP, {x: 1, y: 2, direction: Direction.DOWN});

    game.createBelt(GameObject.BELT, {x: 0, y: 4, direction: Direction.RIGHT});
    game.createBelt(GameObject.RAMP_DOWN, {x: 1, y: 4, direction: Direction.UP});

    game.createBelt(GameObject.BELT, {x: 0, y: 6, direction: Direction.RIGHT});
    game.createBelt(GameObject.RAMP_DOWN, {x: 1, y: 6, direction: Direction.DOWN});

    game.createBelt(GameObject.RAMP_UP, {x: 1, y: 24, direction: Direction.UP});
    game.createBelt(GameObject.BELT, {x: 0, y: 24, direction: Direction.RIGHT});

    game.createBelt(GameObject.RAMP_UP, {x: 1, y: 26, direction: Direction.DOWN});
    game.createBelt(GameObject.BELT, {x: 0, y: 26, direction: Direction.RIGHT});

    game.createBelt(GameObject.RAMP_DOWN, {x: 1, y: 28, direction: Direction.UP});
    game.createBelt(GameObject.BELT, {x: 0, y: 28, direction: Direction.RIGHT});

    game.createBelt(GameObject.RAMP_DOWN, {x: 1, y: 30, direction: Direction.DOWN});
    game.createBelt(GameObject.BELT, {x: 0, y: 30, direction: Direction.RIGHT});

    game.createBelt(GameObject.BELT, {x: 1, y: 12, direction: Direction.UP});
    game.createBelt(GameObject.RAMP_DOWN, {x: 0, y: 12, direction: Direction.RIGHT});

    game.createBelt(GameObject.BELT, {x: 1, y: 14, direction: Direction.DOWN});
    game.createBelt(GameObject.RAMP_DOWN, {x: 0, y: 14, direction: Direction.RIGHT});

    game.createBelt(GameObject.RAMP_DOWN, {x: 0, y: 20, direction: Direction.RIGHT});
    game.createBelt(GameObject.BELT, {x: 1, y: 20, direction: Direction.UP});

    game.createBelt(GameObject.RAMP_DOWN, {x: 0, y: 22, direction: Direction.RIGHT});
    game.createBelt(GameObject.BELT, {x: 1, y: 22, direction: Direction.DOWN});

    assert.equal(game.exec("SELECT COUNT(*) FROM BeltPath WHERE length=1"), 24);

    game.createBelt(GameObject.RAMP_UP, {x: 0, y: 16, direction: Direction.RIGHT});
    game.createBelt(GameObject.BELT, {x: 1, y: 16, direction: Direction.UP});

    game.createBelt(GameObject.RAMP_UP, {x: 0, y: 18, direction: Direction.RIGHT});
    game.createBelt(GameObject.BELT, {x: 1, y: 18, direction: Direction.DOWN});

    assert.equal(game.exec("SELECT COUNT(*) FROM BeltPath WHERE length=(2*2-1)"), 2);

    game.createBelt(GameObject.BELT, {x: 1, y: 10, direction: Direction.DOWN});
    game.createBelt(GameObject.RAMP_UP, {x: 0, y: 10, direction: Direction.RIGHT});

    assert.equal(game.exec("SELECT COUNT(*) FROM BeltPath WHERE length=(2*2-1)"), 3);

    game.createBelt(GameObject.BELT, {x: 1, y: 8, direction: Direction.UP});
    game.createBelt(GameObject.RAMP_UP, {x: 0, y: 8, direction: Direction.RIGHT});

    assert.equal(game.exec("SELECT COUNT(*) FROM BeltPath WHERE length=(2*2-1)"), 4);
});

test("disconnects an existing ramp pair when a ramp is reused and rejects invalid disconnects", async () => {
    const game = await setup();

    game.createBelt(GameObject.RAMP_DOWN, {x: 0, y: 0, direction: Direction.RIGHT});
    game.createBelt(GameObject.RAMP_UP, {x: 3, y: 0, direction: Direction.RIGHT, rampParent: 1n});

    assert.equal(game.exec(`SELECT COUNT(*) FROM Belt WHERE type=${BeltType.UNDERGROUND}`), 2);

    game.createBelt(GameObject.RAMP_UP, {x: 1, y: 0, direction: Direction.RIGHT, rampParent: 1n});
    assert.equal(game.exec("SELECT COUNT(*) FROM Belt"), 4);

    assert.throws(() => {
        game.createBelt(GameObject.RAMP_UP, {x: 1, y: 0, direction: Direction.RIGHT, rampParent: 1n, disconnectRampChild: 1n});
    });
    assert.throws(() => {
        game.createBelt(GameObject.RAMP_UP, {x: 1, y: 0, direction: Direction.RIGHT, disconnectRampChild: 1n});
    });
    assert.throws(() => {
        game.createBelt(GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT, rampParent: 1n, disconnectRampChild: 4n});
    });

    game.createBelt(GameObject.RAMP_UP, {x: 1, y: 0, direction: Direction.RIGHT, rampParent: 1n, disconnectRampChild: 4n});

    assert.equal(game.exec(`SELECT COUNT(*) FROM Belt WHERE type=${BeltType.UNDERGROUND}`), 0);
});

test("ignores deleting a belt that does not exist", async () => {
    const game = await setup();
    game.createBelt(GameObject.BELT, {x: 0, y: 0, direction: Direction.UP});
    game.removeGameObject(GameObject.BELT, 1n);
    game.removeGameObject(GameObject.BELT, 1n);
    assert.equal(game.exec("SELECT COUNT(*) FROM Belt"), 0);
});

test("ignores creating a belt over an existing one", async () => {
    const game = await setup();
    game.createBelt(GameObject.BELT, {x: 0, y: 0, direction: Direction.UP});
    game.createBelt(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    assert.equal(game.exec("SELECT COUNT(*) FROM Belt WHERE x=0 AND y=0"), 1);
});

test("disconnects a ramp pair across a chunk boundary", async () => {
    const game = await setup();
    game.createBelt(GameObject.RAMP_DOWN, {x: -2, y: 0, direction: Direction.RIGHT});
    game.createBelt(GameObject.RAMP_UP, {x: 2, y: 0, direction: Direction.RIGHT, rampParent: 1n});

    assert.equal(game.exec(`SELECT COUNT(*) FROM Belt WHERE type=${BeltType.UNDERGROUND}`), 3);

    game.createBelt(GameObject.RAMP_UP, {x: 1, y: 0, direction: Direction.RIGHT, rampParent: 1n, disconnectRampChild: 5n});

    assert.equal(game.exec(`SELECT COUNT(*) FROM Belt WHERE type=${BeltType.UNDERGROUND}`), 2);
});

test("collapses a multi-segment tunnel when the up ramp is deleted", async () => {
    const game = await setup();
    game.createBelt(GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT});
    game.createBelt(GameObject.RAMP_UP, {x: 4, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    game.removeGameObject(GameObject.BELT, 4n);

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=1 AND length=1"), 1);
    assert.equal(game.exec("SELECT COUNT(*) FROM Belt"), 1);
    assert.equal(game.exec("SELECT COUNT(*) FROM BeltPath"), 1);
});

test("rejoins an upstream belt when the up ramp is deleted", async () => {
    const game = await setup();
    // BELT_NORMAL(0,1)→ RAMP_DOWN(1,1)→ UG(2,1) UG(3,1) RAMP_UP(4,1)
    // ids: BN=1, RAMP_DOWN=2, UG1=3, UG2=4, RAMP_UP=5
    game.createBelt(GameObject.BELT, {x: 0, y: 1, direction: Direction.RIGHT});
    game.createBelt(GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT});
    game.createBelt(GameObject.RAMP_UP, {x: 4, y: 1, direction: Direction.RIGHT, rampParent: 2n});

    game.removeGameObject(GameObject.BELT, 5n);

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=1 AND length=3"), 1);
    assert.equal(game.exec("SELECT COUNT(*) FROM Belt"), 2);
    assert.equal(game.exec("SELECT COUNT(*) FROM BeltPath"), 1);
});

test("rejects manually deleting a tunnel segment without changing state", async () => {
    const game = await setup();
    // RAMP_DOWN(1,1)→ UG(2,1) UG(3,1) → RAMP_UP(4,1). ids: ramp_down=1, ug=2,3, ramp_up=4
    game.createBelt(GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT});
    game.createBelt(GameObject.RAMP_UP, {x: 4, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    // Park an item on the path's output port so a faulty (commit-then-throw) delete
    // would be observable as a cleared port and/or a stranded StashedOutputItem row.
    game._db.db.exec("UPDATE Port SET item=7 WHERE id=(SELECT out_port_id FROM BeltPath WHERE id=1)");

    // Manually deleting a tunnel segment must be rejected...
    assert.throws(() => game.removeGameObject(GameObject.BELT, 2n));

    // ...and must leave all state untouched (no partial commit).
    assert.equal(game.exec("SELECT item FROM Port WHERE id=(SELECT out_port_id FROM BeltPath WHERE id=1)"), 7);
    assert.equal(game.exec("SELECT COUNT(*) FROM StashedOutputItem"), 0);
    assert.equal(game.exec("SELECT COUNT(*) FROM Belt"), 4);
    assert.equal(game.exec("SELECT COUNT(*) FROM BeltPath"), 1);
});
