
import {test} from "node:test";
import assert from "node:assert/strict";
import {setup, GameObject} from "@/test/common.js";
import {BeltType} from "@/mods/Belt/mod.js";
import {Direction, MAX_UNDERGROUND_LENGTH} from "@/common/constants.js";

test("testBeltParent", async () => {
    const game = await setup();

    game.createGameObject(GameObject.BELT, {x: 0, y: 0, direction: Direction.UP});
    game.createGameObject(GameObject.BELT, {x: 0, y: -1, direction: Direction.RIGHT});
    game.createGameObject(GameObject.BELT, {x: 0, y: 1, direction: Direction.UP});

    assert.equal(game.exec("SELECT parent FROM Belt WHERE id=1"), 3);
    assert.equal(game.exec("SELECT parent FROM Belt WHERE id=2"), 1);

    game.createGameObject(GameObject.BELT, {x: 1, y: 1, direction: Direction.LEFT});
    assert.equal(game.exec("SELECT parent FROM Belt WHERE id=3"), 4);

    game.createGameObject(GameObject.BELT, {x: -1, y: 0, direction: Direction.RIGHT});
    assert.equal(game.exec("SELECT parent FROM Belt WHERE id=1"), 5);

    game.createGameObject(GameObject.BELT, {x: 1, y: 0, direction: Direction.LEFT});
    assert.equal(game.exec("SELECT parent FROM Belt WHERE id=1"), 6);
});

test("testBeltCreate1", async () => {
    const game = await setup();
    game.createGameObject(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    game.createGameObject(GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});
    game.createGameObject(GameObject.BELT, {x: 2, y: 0, direction: Direction.RIGHT});

    assert.equal(game.exec("SELECT length=(3*2-1) AND id=1 AND tail=3 FROM BeltPath"), 1);

    game.createGameObject(GameObject.BELT, {x: 1, y: 2, direction: Direction.UP});
    game.createGameObject(GameObject.BELT, {x: 1, y: 1, direction: Direction.UP});

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE length=(4*2-1) AND id=4 AND tail=3"), 1);
    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE length=1 AND id=1 AND tail=1"), 1);
    assert.equal(game.exec("SELECT Count(*) FROM Port"), 4);
});

test("testBeltCreate2", async () => {
    const game = await setup();
    game.createGameObject(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    game.createGameObject(GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});
    game.createGameObject(GameObject.BELT, {x: 2, y: 0, direction: Direction.RIGHT});

    game._db.db.exec("UPDATE Port SET item=2 WHERE id=(SELECT out_port FROM BeltPath WHERE id=1)");

    game.createGameObject(GameObject.BELT, {x: 1, y: 1, direction: Direction.UP});

    assert.equal(game.exec("SELECT 1 FROM BeltPath INNER JOIN Port ON port.id=out_port WHERE BeltPath.id=1 AND item IS NULL"), 1);
    assert.equal(game.exec("SELECT 1 FROM BeltPath INNER JOIN Port ON port.id=out_port WHERE BeltPath.id=4 AND item=2"), 1);
    assert.equal(game.exec("SELECT Count(*) FROM Port"), 4);
});

test("testBeltCreate3", async () => {
    const game = await setup();
    game.createGameObject(GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});

    game._db.db.exec("UPDATE Port SET item=2 WHERE id=(SELECT out_port FROM BeltPath WHERE id=1)");

    game.createGameObject(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});

    assert.equal(game.exec("SELECT 1 FROM BeltPath INNER JOIN Port ON port.id=out_port WHERE BeltPath.id=2 AND item=2"), 1);
    assert.equal(game.exec("SELECT Count(*) FROM Port"), 2);
});

test("testBeltCreate4", async () => {
    const game = await setup();
    game.createGameObject(GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});

    game._db.db.exec("UPDATE Port SET item=1 WHERE id=(SELECT in_port FROM BeltPath WHERE id=1)");
    game.tickBeltPath();

    game.createGameObject(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=2 AND next_item_id IS NOT NULL"), 1);
    assert.equal(game.exec("SELECT 1 FROM BeltPath INNER JOIN Port ON port.id=in_port WHERE BeltPath.id=2 AND item IS NULL"), 1);
});

test("testBeltCreateLoop", async () => {
    const game = await setup();
    game.createGameObject(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    game.createGameObject(GameObject.BELT, {x: 1, y: 0, direction: Direction.DOWN});
    game.createGameObject(GameObject.BELT, {x: 1, y: 1, direction: Direction.LEFT});
    game.createGameObject(GameObject.BELT, {x: 0, y: 1, direction: Direction.UP});

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE length=(4*2-1) AND id=1 AND tail=4"), 1);
    assert.equal(game.exec("SELECT parent FROM Belt WHERE id=1"), null);
});

test("testBeltLink", async () => {
    const game = await setup();
    game.createGameObject(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    game.createGameObject(GameObject.BELT, {x: -1, y: 0, direction: Direction.RIGHT});
    assert.equal(game.exec("SELECT (SELECT in_port FROM BeltPath WHERE id=1) = (SELECT out_port FROM BeltPath WHERE id=2)"), 1);

    game.createGameObject(GameObject.BELT, {x: 0, y: -1, direction: Direction.DOWN});
    assert.equal(game.exec("SELECT (SELECT in_port FROM BeltPath WHERE id=1) = (SELECT out_port FROM BeltPath WHERE id=3)"), 1);

    assert.equal(game.exec("SELECT COUNT(*) FROM Port"), 5);
});

test("testBeltTickCase0", async () => {
    const game = await setup();
    game.createGameObject(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    game.createGameObject(GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});
    game.createGameObject(GameObject.BELT, {x: 2, y: 0, direction: Direction.RIGHT});

    assert.equal(game.exec("SELECT head_gap FROM BeltPath WHERE id=1"), 3*2-1);

    game.tickBeltPath();

    assert.equal(game.exec("SELECT head_gap FROM BeltPath WHERE id=1"), 3*2-1);
});

test("testBeltTick1Item", async () => {
    const game = await setup();
    game.createGameObject(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    game.createGameObject(GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});
    game.createGameObject(GameObject.BELT, {x: 2, y: 0, direction: Direction.RIGHT});

    assert.equal(game.exec("SELECT head_gap FROM BeltPath WHERE id=1"), 3*2-1);

    game._db.db.exec("UPDATE Port SET item=1 WHERE id=(SELECT in_port FROM BeltPath WHERE id=1)");

    game.tickBeltPath();
    assert.equal(game.exec("SELECT head_gap FROM BeltPath WHERE id=1"), 0);

    game.tickBeltPath();
    assert.equal(game.exec("SELECT head_gap FROM BeltPath WHERE id=1"), 1);

    game.tickBeltPath();
    game.tickBeltPath();
    assert.equal(game.exec("SELECT head_gap FROM BeltPath WHERE id=1"), 3);
    game.tickBeltPath();
    game.tickBeltPath();
    assert.equal(game.exec("SELECT item FROM Port WHERE id=(SELECT out_port FROM BeltPath WHERE id=1)"), 1);
});

test("testBeltTick2Items", async () => {
    const game = await setup();
    game.createGameObject(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    game.createGameObject(GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});
    game.createGameObject(GameObject.BELT, {x: 2, y: 0, direction: Direction.RIGHT});

    assert.equal(game.exec("SELECT head_gap FROM BeltPath WHERE id=1"), 3*2-1);

    game._db.db.exec("UPDATE Port SET item=1 WHERE id=(SELECT in_port FROM BeltPath WHERE id=1)");
    game.tickBeltPath();
    game.tickBeltPath();
    game._db.db.exec("UPDATE Port SET item=1 WHERE id=(SELECT in_port FROM BeltPath WHERE id=1)");
    game.tickBeltPath();

    assert.equal(game.exec("SELECT head_gap FROM BeltPath WHERE id=1"), 0);

    game.tickBeltPath();
    game.tickBeltPath();
    assert.equal(game.exec("SELECT head_gap FROM BeltPath WHERE id=1"), 2);
    game.tickBeltPath();
    assert.equal(game.exec("SELECT item FROM Port WHERE id=(SELECT out_port FROM BeltPath WHERE id=1)"), 1);

    game.tickBeltPath();
    assert.equal(game.exec("SELECT head_gap FROM BeltPath WHERE id=1"), 4);

    game._db.db.exec("UPDATE Port SET item=NULL WHERE id=(SELECT out_port FROM BeltPath WHERE id=1)");
    game.tickBeltPath();
    assert.equal(game.exec("SELECT head_gap FROM BeltPath WHERE id=1"), 5);
    assert.equal(game.exec("SELECT item FROM Port WHERE id=(SELECT out_port FROM BeltPath WHERE id=1)"), 1);
});

test("testBeltDeleteStash1", async () => {
    const game = await setup();
    game.createGameObject(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    game.createGameObject(GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});
    game.createGameObject(GameObject.BELT, {x: 2, y: 0, direction: Direction.RIGHT});

    game._db.db.exec("UPDATE Port SET item=1 WHERE id=(SELECT in_port FROM BeltPath WHERE id=1)");
    game._db.db.exec("UPDATE Port SET item=2 WHERE id=(SELECT out_port FROM BeltPath WHERE id=1)");
    game.tickBeltPath();

    game.removeGameObject(GameObject.BELT, 3n);

    assert.equal(game.exec("SELECT 1 FROM Port WHERE id=(SELECT out_port FROM BeltPath WHERE id=1) AND item IS NULL"), 1);
    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=1 AND next_gap_id=3 AND next_item_id=4"), 1);
    assert.equal(game.exec("SELECT 1 FROM BeltPathItem WHERE id=3 AND length=2"), 1);
});

test("testBeltDeleteStash2", async () => {
    const game = await setup();
    game.createGameObject(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    game.createGameObject(GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});
    game.createGameObject(GameObject.BELT, {x: 2, y: 0, direction: Direction.RIGHT});

    game._db.db.exec("UPDATE Port SET item=1 WHERE id=(SELECT in_port FROM BeltPath WHERE id=1)");
    game._db.db.exec("UPDATE Port SET item=2 WHERE id=(SELECT out_port FROM BeltPath WHERE id=1)");
    game.tickBeltPath();

    game.removeGameObject(GameObject.BELT, 2n);

    assert.equal(game.exec("SELECT 1 FROM Port WHERE id=(SELECT out_port FROM BeltPath WHERE id=1) AND item IS NULL"), 1);
    assert.equal(game.exec("SELECT 1 FROM Port WHERE id=(SELECT out_port FROM BeltPath WHERE id=3) AND item=2"), 1);

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=1 AND head_gap=0 AND next_gap_id IS NULL AND next_item_id IS NOT NULL"), 1);
    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=3 AND head_gap=1 AND next_gap_id IS NULL AND next_item_id IS NULL"), 1);
});

test("testBeltDeleteStash3", async () => {
    const game = await setup();
    game.createGameObject(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    game.createGameObject(GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});
    game.createGameObject(GameObject.BELT, {x: 2, y: 0, direction: Direction.RIGHT});

    game._db.db.exec("UPDATE Port SET item=1 WHERE id=(SELECT in_port FROM BeltPath WHERE id=1)");
    game._db.db.exec("UPDATE Port SET item=2 WHERE id=(SELECT out_port FROM BeltPath WHERE id=1)");
    game.tickBeltPath();

    game.removeGameObject(GameObject.BELT, 1n);

    assert.equal(game.exec("SELECT 1 FROM Port WHERE id=(SELECT out_port FROM BeltPath WHERE id=2) AND item=2"), 1);
    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=2 AND head_gap=(2*2-1) AND next_gap_id IS NULL AND next_item_id IS NULL"), 1);
});

test("testBeltDeleteCreateStash", async () => {
    const game = await setup();
    game.createGameObject(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    game.createGameObject(GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=1 AND head_gap=(2*2-1)"), 1);

    game._db.db.exec("UPDATE Port SET item=1 WHERE id=(SELECT in_port FROM BeltPath WHERE id=1)");
    game.tickBeltPath();

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=1 AND head_gap=0"), 1);

    game.createGameObject(GameObject.BELT, {x: 2, y: 0, direction: Direction.RIGHT});

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=1 AND head_gap=0"), 1);
});

test("testBeltLinkDeleteChild", async () => {
    const game = await setup();
    game.createGameObject(GameObject.BELT, {x: -1, y: 0, direction: Direction.RIGHT});
    game.createGameObject(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});

    assert.equal(game.exec("SELECT (SELECT out_port FROM BeltPath WHERE id=1) = (SELECT in_port FROM BeltPath WHERE id=2)"), 1);
    assert.equal(game.exec("SELECT COUNT(*) FROM Port"), 3);

    game.removeGameObject(GameObject.BELT, 2n);

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE in_port IS NULL OR out_port IS NULL"), undefined);
    assert.equal(game.exec("SELECT COUNT(*) FROM Port"), 2);
});

test("testBeltLinkDeleteParent", async () => {
    const game = await setup();
    game.createGameObject(GameObject.BELT, {x: -1, y: 0, direction: Direction.RIGHT});
    game.createGameObject(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});

    assert.equal(game.exec("SELECT (SELECT out_port FROM BeltPath WHERE id=1) = (SELECT in_port FROM BeltPath WHERE id=2)"), 1);

    game.removeGameObject(GameObject.BELT, 1n);

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE in_port IS NULL OR out_port IS NULL"), undefined);
    assert.equal(game.exec("SELECT COUNT(*) FROM Port"), 2);
});

test("testUndergroundBelt1", async () => {
    const game = await setup();
    game.createGameObject(GameObject.BELT, {x: 0, y: 10, direction: Direction.RIGHT});
    game.createGameObject(GameObject.BELT, {x: 1, y: 10, direction: Direction.RIGHT});
    game.createGameObject(GameObject.BELT, {x: 2, y: 10, direction: Direction.RIGHT});

    game.createGameObject(GameObject.BELT, {x: 1, y: 12, direction: Direction.UP});
    game.createGameObject(GameObject.RAMP_DOWN, {x: 1, y: 11, direction: Direction.UP});
    game.createGameObject(GameObject.RAMP_UP, {x: 1, y: 9, direction: Direction.UP, rampParent: 5n});
    game.createGameObject(GameObject.BELT, {x: 1, y: 8, direction: Direction.UP});

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=1 AND length=(3*2-1)"), 1);
    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=4 AND length=(5*2-1)"), 1);
});

test("testUnderground0Gap", async () => {
    const game = await setup();
    game.createGameObject(GameObject.RAMP_DOWN, {x: 1, y: 10, direction: Direction.UP});
    game.createGameObject(GameObject.RAMP_UP, {x: 1, y: 9, direction: Direction.UP, rampParent: 1n});

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=1 AND length=(2*2-1)"), 1);
});

test("testUnderground0Gap2", async () => {
    const game = await setup();
    game.createGameObject(GameObject.RAMP_UP, {x: 1, y: 0, direction: Direction.LEFT});
    game.createGameObject(GameObject.RAMP_DOWN, {x: 2, y: 0, direction: Direction.LEFT, rampParent: 1n});

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=2 AND length=(2*2-1)"), 1);
});

test("testUndergroundBelt2", async () => {
    const game = await setup();
    game.createGameObject(GameObject.BELT, {x: 10, y: 0, direction: Direction.DOWN});
    game.createGameObject(GameObject.BELT, {x: 10, y: 1, direction: Direction.DOWN});
    game.createGameObject(GameObject.BELT, {x: 10, y: 2, direction: Direction.DOWN});

    game.createGameObject(GameObject.BELT, {x: 12, y: 1, direction: Direction.LEFT});
    game.createGameObject(GameObject.RAMP_DOWN, {x: 11, y: 1, direction: Direction.LEFT});
    game.createGameObject(GameObject.RAMP_UP, {x: 9, y: 1, direction: Direction.LEFT, rampParent: 5n});
    game.createGameObject(GameObject.BELT, {x: 8, y: 1, direction: Direction.LEFT});

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=1 AND length=(3*2-1)"), 1);
    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=4 AND length=(5*2-1)"), 1);
});

test("testUndergroundBeltMaxLen", async () => {
    const game = await setup();
    game.createGameObject(GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT});
    game.createGameObject(GameObject.RAMP_UP, {x: 1 + MAX_UNDERGROUND_LENGTH + 1, y: 1, direction: Direction.RIGHT, rampParent: 1n});
    assert.equal(game.exec(`SELECT 1 FROM BeltPath WHERE id=1 AND length=${(MAX_UNDERGROUND_LENGTH + 2)*2-1}`), 1);
});

test("testUndergroundBeltMaxLen2", async () => {
    const game = await setup();
    game.createGameObject(GameObject.RAMP_UP, {x: 1 + MAX_UNDERGROUND_LENGTH + 1, y: 1, direction: Direction.RIGHT});
    game.createGameObject(GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    assert.equal(game.exec(`SELECT 1 FROM BeltPath WHERE id=${MAX_UNDERGROUND_LENGTH + 2} AND length=${(MAX_UNDERGROUND_LENGTH + 2)*2-1}`), 1);
    assert.equal(game.exec("SELECT COUNT(*) FROM BeltPath"), 1);
});

test("testUndergroundBeltTooLong", async () => {
    const game = await setup();
    game.createGameObject(GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT});
    game.createGameObject(GameObject.RAMP_UP, {x: 1 + MAX_UNDERGROUND_LENGTH + 2, y: 1, direction: Direction.RIGHT, rampParent: 1n});
    assert.equal(game.exec(`SELECT 1 FROM BeltPath WHERE id=1 AND length=${(MAX_UNDERGROUND_LENGTH + 3)*2-1}`), undefined);
});

test("testUndergroundBeltTooLong2", async () => {
    const game = await setup();
    game.createGameObject(GameObject.RAMP_UP, {x: 1 + MAX_UNDERGROUND_LENGTH + 2, y: 1, direction: Direction.RIGHT});
    game.createGameObject(GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    assert.equal(game.exec(`SELECT 1 FROM BeltPath WHERE id=${MAX_UNDERGROUND_LENGTH + 3} AND length=${(MAX_UNDERGROUND_LENGTH + 3)*2-1}`), undefined);
    assert.equal(game.exec("SELECT COUNT(*) FROM BeltPath"), 2);
});

test("testUndergroundBeltDeleteUpRamp", async () => {
    const game = await setup();
    game.createGameObject(GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT});
    game.createGameObject(GameObject.RAMP_UP, {x: 3, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    game.removeGameObject(GameObject.BELT, 3n);

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=1 AND length=1"), 1);
    assert.equal(game.exec("SELECT COUNT(*) FROM Belt"), 1);
    assert.equal(game.exec("SELECT COUNT(*) FROM BeltPath"), 1);
});

test("testUndergroundBeltDeleteDownRamp", async () => {
    const game = await setup();
    game.createGameObject(GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT});
    game.createGameObject(GameObject.RAMP_UP, {x: 3, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    game.removeGameObject(GameObject.BELT, 1n);

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=3 AND length=1"), 1);
    assert.equal(game.exec("SELECT COUNT(*) FROM Belt"), 1);
    assert.equal(game.exec("SELECT COUNT(*) FROM BeltPath"), 1);
});

test("testUndergroundBeltDeleteDownRamp2", async () => {
    const game = await setup();
    game.createGameObject(GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT});
    game.createGameObject(GameObject.RAMP_UP, {x: 3, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    game._db.db.exec("UPDATE Port SET item=1 WHERE id=(SELECT in_port FROM BeltPath WHERE id=1)");
    game.tickBeltPath();

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=1 AND length=(3*2-1) AND head_gap=0"), 1);

    game.removeGameObject(GameObject.BELT, 3n);

    assert.equal(game.exec("SELECT 1 FROM BeltPathItem WHERE path=1 AND type=1"), 1);
    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=1 AND length=1 AND head_gap=0"), 1);
    assert.equal(game.exec("SELECT COUNT(*) FROM Belt"), 1);
    assert.equal(game.exec("SELECT COUNT(*) FROM BeltPath"), 1);
});

test("testUndergroundBeltDeleteDownRamp3", async () => {
    const game = await setup();
    game.createGameObject(GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT});
    game.createGameObject(GameObject.RAMP_UP, {x: 3, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    game._db.db.exec("UPDATE Port SET item=1 WHERE id=(SELECT in_port FROM BeltPath WHERE id=1)");
    game.tickBeltPath();
    game.tickBeltPath();

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=1 AND length=(3*2-1) AND head_gap=1"), 1);

    game.removeGameObject(GameObject.BELT, 3n);

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=1 AND length=1 AND head_gap=1"), 1);
    assert.equal(game.exec("SELECT COUNT(*) FROM Belt"), 1);
    assert.equal(game.exec("SELECT COUNT(*) FROM BeltPath"), 1);
    assert.equal(game.exec("SELECT 1 FROM BeltPathItem"), undefined);
});

test("testUndergroundBeltDeleteDownRamp0Gap", async () => {
    const game = await setup();
    game.createGameObject(GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT});
    game.createGameObject(GameObject.RAMP_UP, {x: 2, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    game.removeGameObject(GameObject.BELT, 1n);

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=2 AND length=1"), 1);
    assert.equal(game.exec("SELECT COUNT(*) FROM Belt"), 1);
    assert.equal(game.exec("SELECT COUNT(*) FROM BeltPath"), 1);
});

test("testUndergroundBeltDeleteUpRamp0Gap", async () => {
    const game = await setup();
    game.createGameObject(GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT});
    game.createGameObject(GameObject.RAMP_UP, {x: 2, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    game.removeGameObject(GameObject.BELT, 2n);

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=1 AND length=1"), 1);
    assert.equal(game.exec("SELECT COUNT(*) FROM Belt"), 1);
    assert.equal(game.exec("SELECT COUNT(*) FROM BeltPath"), 1);
});

test("testUndergroundBeltCrossChunk0Gap", async () => {
    const game = await setup();
    game.createGameObject(GameObject.RAMP_DOWN, {x: -1, y: 1, direction: Direction.RIGHT});
    game.createGameObject(GameObject.RAMP_UP, {x: 0, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    assert.equal(game.exec("SELECT (SELECT out_port FROM BeltPath WHERE id=1) = (SELECT in_port FROM BeltPath WHERE id=2)"), 1);

    game._db.db.exec("UPDATE Port SET item=1 WHERE id=(SELECT in_port FROM BeltPath WHERE id=1)");
    game.tickBeltPath();
    game.tickBeltPath();

    assert.equal(game.exec("SELECT 1 FROM BeltPathItem WHERE path=2"), 1);
    game.tickBeltPath();
    assert.equal(game.exec("SELECT 1 FROM Port WHERE id=(SELECT out_port FROM BeltPath WHERE id=2) AND item=1"), 1);

    game.removeGameObject(GameObject.BELT, 1n);

    assert.equal(game.exec("SELECT (SELECT out_port FROM BeltPath WHERE id=1) = (SELECT in_port FROM BeltPath WHERE id=2)"), null);
    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE in_port IS NULL OR out_port IS NULL"), undefined);

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=2 AND length=1"), 1);
    assert.equal(game.exec("SELECT COUNT(*) FROM Belt"), 1);
    assert.equal(game.exec("SELECT COUNT(*) FROM BeltPath"), 1);
});

test("testUndergroundBeltCrossChunk1", async () => {
    const game = await setup();
    game.createGameObject(GameObject.RAMP_DOWN, {x: -1, y: 1, direction: Direction.RIGHT});
    game.createGameObject(GameObject.RAMP_UP, {x: 1, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    assert.equal(game.exec("SELECT (SELECT out_port FROM BeltPath WHERE id=1) = (SELECT in_port FROM BeltPath WHERE id=2)"), 1);
    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=1 AND length=1"), 1);
    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=2 AND length=(2*2-1)"), 1);

    game._db.db.exec("UPDATE Port SET item=1 WHERE id=(SELECT in_port FROM BeltPath WHERE id=1)");
    game.tickBeltPath();
    game.tickBeltPath();
    game.tickBeltPath();

    assert.equal(game.exec("SELECT 1 FROM BeltPathItem WHERE path=2"), 1);
});

test("testUndergroundBeltCrossChunk2", async () => {
    const game = await setup();
    game.createGameObject(GameObject.RAMP_DOWN, {x: -2, y: 1, direction: Direction.RIGHT});
    game.createGameObject(GameObject.RAMP_UP, {x: 0, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    assert.equal(game.exec("SELECT (SELECT out_port FROM BeltPath WHERE id=1) = (SELECT in_port FROM BeltPath WHERE id=3)"), 1);
    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=1 AND length=(2*2-1)"), 1);
    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=3 AND length=1"), 1);
});

test("testUndergroundBeltCrossChunk3", async () => {
    const game = await setup();
    game.createGameObject(GameObject.RAMP_DOWN, {x: -2, y: 1, direction: Direction.RIGHT});
    game.createGameObject(GameObject.RAMP_UP, {x: 1, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    assert.equal(game.exec("SELECT (SELECT out_port FROM BeltPath WHERE id=1) = (SELECT in_port FROM BeltPath WHERE id=3)"), 1);
    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=1 AND length=(2*2-1)"), 1);
    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=3 AND length=(2*2-1)"), 1);
});

test("testUndergroundBeltCrossChunk4", async () => {
    const game = await setup();
    game.createGameObject(GameObject.RAMP_UP, {x: 1, y: 1, direction: Direction.RIGHT});
    game.createGameObject(GameObject.RAMP_DOWN, {x: -2, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    assert.equal(game.exec("SELECT (SELECT out_port FROM BeltPath WHERE id=4) = (SELECT in_port FROM BeltPath WHERE id=3)"), 1);
    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=4 AND length=(2*2-1)"), 1);
    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=3 AND length=(2*2-1)"), 1);
});

test("testRampConnection1", async () => {
    const game = await setup();
    game.createGameObject(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    game.createGameObject(GameObject.RAMP_DOWN, {x: 1, y: 0, direction: Direction.RIGHT});
    game.createGameObject(GameObject.BELT, {x: 2, y: 0, direction: Direction.RIGHT});

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=1 AND length=(2*2-1)"), 1);
    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=3 AND length=1"), 1);
});

test("testRampConnection2", async () => {
    const game = await setup();
    game.createGameObject(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    game.createGameObject(GameObject.RAMP_UP, {x: 1, y: 0, direction: Direction.RIGHT});
    game.createGameObject(GameObject.BELT, {x: 2, y: 0, direction: Direction.RIGHT});

    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=1 AND length=1"), 1);
    assert.equal(game.exec("SELECT 1 FROM BeltPath WHERE id=2 AND length=(2*2-1)"), 1);
});

test("testRampConnection3", async () => {
    const game = await setup();

    game.createGameObject(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    game.createGameObject(GameObject.RAMP_UP, {x: 1, y: 0, direction: Direction.UP});

    game.createGameObject(GameObject.BELT, {x: 0, y: 2, direction: Direction.RIGHT});
    game.createGameObject(GameObject.RAMP_UP, {x: 1, y: 2, direction: Direction.DOWN});

    game.createGameObject(GameObject.BELT, {x: 0, y: 4, direction: Direction.RIGHT});
    game.createGameObject(GameObject.RAMP_DOWN, {x: 1, y: 4, direction: Direction.UP});

    game.createGameObject(GameObject.BELT, {x: 0, y: 6, direction: Direction.RIGHT});
    game.createGameObject(GameObject.RAMP_DOWN, {x: 1, y: 6, direction: Direction.DOWN});

    game.createGameObject(GameObject.RAMP_UP, {x: 1, y: 24, direction: Direction.UP});
    game.createGameObject(GameObject.BELT, {x: 0, y: 24, direction: Direction.RIGHT});

    game.createGameObject(GameObject.RAMP_UP, {x: 1, y: 26, direction: Direction.DOWN});
    game.createGameObject(GameObject.BELT, {x: 0, y: 26, direction: Direction.RIGHT});

    game.createGameObject(GameObject.RAMP_DOWN, {x: 1, y: 28, direction: Direction.UP});
    game.createGameObject(GameObject.BELT, {x: 0, y: 28, direction: Direction.RIGHT});

    game.createGameObject(GameObject.RAMP_DOWN, {x: 1, y: 30, direction: Direction.DOWN});
    game.createGameObject(GameObject.BELT, {x: 0, y: 30, direction: Direction.RIGHT});

    game.createGameObject(GameObject.BELT, {x: 1, y: 12, direction: Direction.UP});
    game.createGameObject(GameObject.RAMP_DOWN, {x: 0, y: 12, direction: Direction.RIGHT});

    game.createGameObject(GameObject.BELT, {x: 1, y: 14, direction: Direction.DOWN});
    game.createGameObject(GameObject.RAMP_DOWN, {x: 0, y: 14, direction: Direction.RIGHT});

    game.createGameObject(GameObject.RAMP_DOWN, {x: 0, y: 20, direction: Direction.RIGHT});
    game.createGameObject(GameObject.BELT, {x: 1, y: 20, direction: Direction.UP});

    game.createGameObject(GameObject.RAMP_DOWN, {x: 0, y: 22, direction: Direction.RIGHT});
    game.createGameObject(GameObject.BELT, {x: 1, y: 22, direction: Direction.DOWN});

    assert.equal(game.exec("SELECT COUNT(*) FROM BeltPath WHERE length=1"), 24);

    game.createGameObject(GameObject.RAMP_UP, {x: 0, y: 16, direction: Direction.RIGHT});
    game.createGameObject(GameObject.BELT, {x: 1, y: 16, direction: Direction.UP});

    game.createGameObject(GameObject.RAMP_UP, {x: 0, y: 18, direction: Direction.RIGHT});
    game.createGameObject(GameObject.BELT, {x: 1, y: 18, direction: Direction.DOWN});

    assert.equal(game.exec("SELECT COUNT(*) FROM BeltPath WHERE length=(2*2-1)"), 2);

    game.createGameObject(GameObject.BELT, {x: 1, y: 10, direction: Direction.DOWN});
    game.createGameObject(GameObject.RAMP_UP, {x: 0, y: 10, direction: Direction.RIGHT});

    assert.equal(game.exec("SELECT COUNT(*) FROM BeltPath WHERE length=(2*2-1)"), 3);

    game.createGameObject(GameObject.BELT, {x: 1, y: 8, direction: Direction.UP});
    game.createGameObject(GameObject.RAMP_UP, {x: 0, y: 8, direction: Direction.RIGHT});

    assert.equal(game.exec("SELECT COUNT(*) FROM BeltPath WHERE length=(2*2-1)"), 4);
});

test("testDisconnectRamp", async () => {
    const game = await setup();

    game.createGameObject(GameObject.RAMP_DOWN, {x: 0, y: 0, direction: Direction.RIGHT});
    game.createGameObject(GameObject.RAMP_UP, {x: 3, y: 0, direction: Direction.RIGHT, rampParent: 1n});

    assert.equal(game.exec(`SELECT COUNT(*) FROM Belt WHERE type=${BeltType.UNDERGROUND}`), 2);

    assert.throws(() => {
        game.createGameObject(GameObject.RAMP_UP, {x: 1, y: 0, direction: Direction.RIGHT, rampParent: 1n});
    });
    assert.throws(() => {
        game.createGameObject(GameObject.RAMP_UP, {x: 1, y: 0, direction: Direction.RIGHT, rampParent: 1n, disconnectRampChild: 1n});
    });
    assert.throws(() => {
        game.createGameObject(GameObject.RAMP_UP, {x: 1, y: 0, direction: Direction.RIGHT, disconnectRampChild: 1n});
    });
    assert.throws(() => {
        game.createGameObject(GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT, rampParent: 1n, disconnectRampChild: 4n});
    });

    game.createGameObject(GameObject.RAMP_UP, {x: 1, y: 0, direction: Direction.RIGHT, rampParent: 1n, disconnectRampChild: 4n});

    assert.equal(game.exec(`SELECT COUNT(*) FROM Belt WHERE type=${BeltType.UNDERGROUND}`), 0);
});

test("testDisconnectRampCrossChunk", async () => {
    const game = await setup();
    game.createGameObject(GameObject.RAMP_DOWN, {x: -2, y: 0, direction: Direction.RIGHT});
    game.createGameObject(GameObject.RAMP_UP, {x: 2, y: 0, direction: Direction.RIGHT, rampParent: 1n});

    assert.equal(game.exec(`SELECT COUNT(*) FROM Belt WHERE type=${BeltType.UNDERGROUND}`), 3);

    game.createGameObject(GameObject.RAMP_UP, {x: 1, y: 0, direction: Direction.RIGHT, rampParent: 1n, disconnectRampChild: 5n});

    assert.equal(game.exec(`SELECT COUNT(*) FROM Belt WHERE type=${BeltType.UNDERGROUND}`), 2);
});
