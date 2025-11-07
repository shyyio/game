import {BrowserGameBackend} from "@/backend/BrowserGameBackend.js";
import {BeltType, Direction, GameObject, MAX_UNDERGROUND_LENGTH} from "@/backend/constants.js";
import {assert, assertThrowsError, executeTests, setup} from "@/tests/common.js";

async function testBeltParent() {

    const backend = await setup();

    backend.createGameObject(GameObject.BELT, {x: 0, y: 0, direction: Direction.UP});
    backend.createGameObject(GameObject.BELT, {x: 0, y: -1, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.BELT, {x: 0, y: 1, direction: Direction.UP});

    assert(backend.exec("SELECT parent FROM Belt WHERE id=1"), 3);
    assert(backend.exec("SELECT parent FROM Belt WHERE id=2"), 1);

    // Same chunk
    backend.createGameObject(GameObject.BELT, {x: 1, y: 1, direction: Direction.LEFT});
    assert(backend.exec("SELECT parent FROM Belt WHERE id=3"), 4);

    // Different chunk
    backend.createGameObject(GameObject.BELT, {x: -1, y: 0, direction: Direction.RIGHT});
    assert(backend.exec("SELECT parent FROM Belt WHERE id=1"), 5);

    // Same chunk
    backend.createGameObject(GameObject.BELT, {x: 1, y: 0, direction: Direction.LEFT});
    assert(backend.exec("SELECT parent FROM Belt WHERE id=1"), 6);
}

async function testBeltCreate1() {

    const backend = await setup();
    backend.createGameObject(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.BELT, {x: 2, y: 0, direction: Direction.RIGHT});

    assert(backend.exec("SELECT length=(3*2-1) AND id=1 AND tail=3 FROM BeltPath"), 1);

    backend.createGameObject(GameObject.BELT, {x: 1, y: 2, direction: Direction.UP});
    backend.createGameObject(GameObject.BELT, {x: 1, y: 1, direction: Direction.UP});

    assert(backend.exec("SELECT 1 FROM BeltPath WHERE length=(4*2-1) AND id=4 AND tail=3"), 1);
    assert(backend.exec("SELECT 1 FROM BeltPath WHERE length=1 AND id=1 AND tail=1"), 1);
    assert(backend.exec("SELECT Count(*) FROM Port"), 4);
}

async function testBeltCreate2() {

    const backend = await setup();
    backend.createGameObject(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.BELT, {x: 2, y: 0, direction: Direction.RIGHT});

    backend.exec("UPDATE Port SET item=2 WHERE id=(SELECT out_port FROM BeltPath WHERE id=1)");

    backend.createGameObject(GameObject.BELT, {x: 1, y: 1, direction: Direction.UP});

    assert(backend.exec("SELECT 1 FROM BeltPath INNER JOIN Port ON port.id=out_port WHERE BeltPath.id=1 AND item IS NULL"), 1);
    assert(backend.exec("SELECT 1 FROM BeltPath INNER JOIN Port ON port.id=out_port WHERE BeltPath.id=4 AND item=2"), 1);
    assert(backend.exec("SELECT Count(*) FROM Port"), 4);
}

async function testBeltCreate3() {
    const backend = await setup();
    backend.createGameObject(GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});

    backend.exec("UPDATE Port SET item=2 WHERE id=(SELECT out_port FROM BeltPath WHERE id=1)");

    backend.createGameObject(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});

    assert(backend.exec("SELECT 1 FROM BeltPath INNER JOIN Port ON port.id=out_port WHERE BeltPath.id=2 AND item=2"), 1);
    assert(backend.exec("SELECT Count(*) FROM Port"), 2);
}

async function testBeltCreate4() {
    const backend = await setup();
    backend.createGameObject(GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});

    backend.exec("UPDATE Port SET item=1 WHERE id = (SELECT in_port FROM BeltPath WHERE id=1)");
    backend.tickBeltPath();

    backend.createGameObject(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});

    assert(backend.exec("SELECT 1 FROM BeltPath WHERE id=2 AND next_item_id IS NOT NULL"), 1);
    assert(backend.exec("SELECT 1 FROM BeltPath INNER JOIN Port ON port.id=in_port WHERE BeltPath.id=2 AND item IS NULL"), 1);
}

async function testBeltCreateLoop() {
    const backend = await setup();
    backend.createGameObject(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.BELT, {x: 1, y: 0, direction: Direction.DOWN});
    backend.createGameObject(GameObject.BELT, {x: 1, y: 1, direction: Direction.LEFT});
    backend.createGameObject(GameObject.BELT, {x: 0, y: 1, direction: Direction.UP});

    assert(backend.exec("SELECT 1 FROM BeltPath WHERE length=(4*2-1) AND id=1 AND tail=4"), 1);
    assert(backend.exec("SELECT parent FROM Belt WHERE id=1"), null);
}

async function testBeltLink() {

    const backend = await setup();
    backend.createGameObject(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.BELT, {x: -1, y: 0, direction: Direction.RIGHT});
    assert(backend.exec("SELECT (SELECT in_port FROM BeltPath WHERE id=1) = (SELECT out_port FROM BeltPath WHERE id=2)"), 1);

    backend.createGameObject(GameObject.BELT, {x: 0, y: -1, direction: Direction.DOWN});
    assert(backend.exec("SELECT (SELECT in_port FROM BeltPath WHERE id=1) = (SELECT out_port FROM BeltPath WHERE id=3)"), 1);

    assert(backend.exec("SELECT COUNT(*) FROM Port"), 5);
}

async function testBeltTickCase0() {
    const backend = await setup();

    backend.createGameObject(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.BELT, {x: 2, y: 0, direction: Direction.RIGHT});

    assert(backend.exec("SELECT head_gap FROM BeltPath WHERE id=1"), 3*2-1);

    backend.tickBeltPath();

    assert(backend.exec("SELECT head_gap FROM BeltPath WHERE id=1"), 3*2-1);
}

async function testBeltTick1Item() {
    const backend = await setup();

    backend.createGameObject(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.BELT, {x: 2, y: 0, direction: Direction.RIGHT});

    assert(backend.exec("SELECT head_gap FROM BeltPath WHERE id=1"), 3*2-1);

    backend.exec("UPDATE Port SET item=1 WHERE id=(SELECT in_port FROM BeltPath WHERE id=1)");

    backend.tickBeltPath();
    assert(backend.exec("SELECT head_gap FROM BeltPath WHERE id=1"), 0);

    backend.tickBeltPath();
    assert(backend.exec("SELECT head_gap FROM BeltPath WHERE id=1"), 1);

    backend.tickBeltPath();
    backend.tickBeltPath();
    assert(backend.exec("SELECT head_gap FROM BeltPath WHERE id=1"), 3);
    backend.tickBeltPath();
    backend.tickBeltPath();
    assert(backend.exec("SELECT item FROM Port WHERE id=(SELECT out_port FROM BeltPath WHERE id=1)"), 1);
}

async function testBeltTick2Items() {
    const backend = await setup();

    backend.createGameObject(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.BELT, {x: 2, y: 0, direction: Direction.RIGHT});

    assert(backend.exec("SELECT head_gap FROM BeltPath WHERE id=1"), 3*2-1);

    backend.exec("UPDATE Port SET item=1 WHERE id=(SELECT in_port FROM BeltPath WHERE id=1)");
    backend.tickBeltPath();
    backend.tickBeltPath();
    backend.exec("UPDATE Port SET item=1 WHERE id=(SELECT in_port FROM BeltPath WHERE id=1)");
    backend.tickBeltPath();

    assert(backend.exec("SELECT head_gap FROM BeltPath WHERE id=1"), 0);

    backend.tickBeltPath();
    backend.tickBeltPath();
    assert(backend.exec("SELECT head_gap FROM BeltPath WHERE id=1"), 2);
    backend.tickBeltPath();
    assert(backend.exec("SELECT item FROM Port WHERE id=(SELECT out_port FROM BeltPath WHERE id=1)"), 1);

    backend.tickBeltPath();
    assert(backend.exec("SELECT head_gap FROM BeltPath WHERE id=1"), 4);

    backend.exec("UPDATE Port SET item=NULL WHERE id=(SELECT out_port FROM BeltPath WHERE id=1)");
    backend.tickBeltPath();
    assert(backend.exec("SELECT head_gap FROM BeltPath WHERE id=1"), 5);
    assert(backend.exec("SELECT item FROM Port WHERE id=(SELECT out_port FROM BeltPath WHERE id=1)"), 1);
}

async function testBeltDeleteStash1() {
    const backend = await setup();

    backend.createGameObject(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.BELT, {x: 2, y: 0, direction: Direction.RIGHT});

    backend.exec("UPDATE Port SET item=1 WHERE id=(SELECT in_port FROM BeltPath WHERE id=1)");
    backend.exec("UPDATE Port SET item=2 WHERE id=(SELECT out_port FROM BeltPath WHERE id=1)");
    backend.tickBeltPath();

    backend.removeGameObject(GameObject.BELT, 3n);

    assert(backend.exec("SELECT 1 FROM Port WHERE id=(SELECT out_port FROM BeltPath WHERE id=1) AND item IS NULL"), 1);
    assert(backend.exec("SELECT 1 FROM BeltPath WHERE id=1 AND next_gap_id=3 AND next_item_id=4"), 1);
    assert(backend.exec("SELECT 1 FROM BeltPathItem WHERE id=3 AND length=2"), 1);
}

async function testBeltDeleteStash2() {
    const backend = await setup();

    backend.createGameObject(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.BELT, {x: 2, y: 0, direction: Direction.RIGHT});

    backend.exec("UPDATE Port SET item=1 WHERE id=(SELECT in_port FROM BeltPath WHERE id=1)");
    backend.exec("UPDATE Port SET item=2 WHERE id=(SELECT out_port FROM BeltPath WHERE id=1)");
    backend.tickBeltPath();

    backend.removeGameObject(GameObject.BELT, 2n);

    assert(backend.exec("SELECT 1 FROM Port WHERE id=(SELECT out_port FROM BeltPath WHERE id=1) AND item IS NULL"), 1);
    assert(backend.exec("SELECT 1 FROM Port WHERE id=(SELECT out_port FROM BeltPath WHERE id=3) AND item=2"), 1);

    assert(backend.exec("SELECT 1 FROM BeltPath WHERE id=1 AND head_gap=0 AND next_gap_id IS NULL AND next_item_id IS NOT NULL"), 1);
    assert(backend.exec("SELECT 1 FROM BeltPath WHERE id=3 AND head_gap=1 AND next_gap_id IS NULL AND next_item_id IS NULL"), 1);
}

async function testBeltDeleteStash3() {
    const backend = await setup();

    backend.createGameObject(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.BELT, {x: 2, y: 0, direction: Direction.RIGHT});

    backend.exec("UPDATE Port SET item=1 WHERE id=(SELECT in_port FROM BeltPath WHERE id=1)");
    backend.exec("UPDATE Port SET item=2 WHERE id=(SELECT out_port FROM BeltPath WHERE id=1)");
    backend.tickBeltPath();

    backend.removeGameObject(GameObject.BELT, 1n);

    assert(backend.exec("SELECT 1 FROM Port WHERE id=(SELECT out_port FROM BeltPath WHERE id=2) AND item=2"), 1);
    assert(backend.exec("SELECT 1 FROM BeltPath WHERE id=2 AND head_gap=(2*2-1) AND next_gap_id IS NULL AND next_item_id IS NULL"), 1);
}

async function testBeltDeleteCreateStash() {
    const backend = await setup();

    backend.createGameObject(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT});

    assert(backend.exec("SELECT 1 FROM BeltPath WHERE id=1 AND head_gap=(2*2-1)"), 1);

    backend.exec("UPDATE Port SET item=1 WHERE id=(SELECT in_port FROM BeltPath WHERE id=1)");
    backend.tickBeltPath();

    assert(backend.exec("SELECT 1 FROM BeltPath WHERE id=1 AND head_gap=0"), 1);

    backend.createGameObject(GameObject.BELT, {x: 2, y: 0, direction: Direction.RIGHT});

    assert(backend.exec("SELECT 1 FROM BeltPath WHERE id=1 AND head_gap=0"), 1);
}

async function testBeltLinkDeleteChild() {

    const backend = await setup();

    backend.createGameObject(GameObject.BELT, {x: -1, y: 0, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});

    assert(backend.exec("SELECT (SELECT out_port FROM BeltPath WHERE id=1) = (SELECT in_port FROM BeltPath WHERE id=2)"), 1);
    assert(backend.exec("SELECT COUNT(*) FROM Port"), 3);

    backend.removeGameObject(GameObject.BELT, 2n);

    assert(backend.exec("SELECT 1 FROM BeltPath WHERE in_port IS NULL OR out_port IS NULL"), undefined);
    assert(backend.exec("SELECT COUNT(*) FROM Port"), 2);
}

async function testBeltLinkDeleteParent() {
    const backend = await setup();

    backend.createGameObject(GameObject.BELT, {x: -1, y: 0, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});

    assert(backend.exec("SELECT (SELECT out_port FROM BeltPath WHERE id=1) = (SELECT in_port FROM BeltPath WHERE id=2)"), 1);

    backend.removeGameObject(GameObject.BELT, 1n);

    assert(backend.exec("SELECT 1 FROM BeltPath WHERE in_port IS NULL OR out_port IS NULL"), undefined);
    assert(backend.exec("SELECT COUNT(*) FROM Port"), 2);
}

async function testUndergroundBelt1() {
    const backend = await setup();

    backend.createGameObject(GameObject.BELT, {x: 0, y: 10, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.BELT, {x: 1, y: 10, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.BELT, {x: 2, y: 10, direction: Direction.RIGHT});

    backend.createGameObject(GameObject.BELT, {x: 1, y: 12, direction: Direction.UP});
    backend.createGameObject(GameObject.RAMP_DOWN, {x: 1, y: 11, direction: Direction.UP});
    backend.createGameObject(GameObject.RAMP_UP, {x: 1, y: 9, direction: Direction.UP, rampParent: 5n});
    backend.createGameObject(GameObject.BELT, {x: 1, y: 8, direction: Direction.UP});

    assert(backend.exec("SELECT 1 FROM BeltPath WHERE id=1 AND length=(3*2-1)"), 1);
    assert(backend.exec("SELECT 1 FROM BeltPath WHERE id=4 AND length=(5*2-1)"), 1);
}

async function testUnderground0Gap() {
    const backend = await setup();

    backend.createGameObject(GameObject.RAMP_DOWN, {x: 1, y: 10, direction: Direction.UP});
    backend.createGameObject(GameObject.RAMP_UP, {x: 1, y: 9, direction: Direction.UP, rampParent: 1n});

    assert(backend.exec("SELECT 1 FROM BeltPath WHERE id=1 AND length=(2*2-1)"), 1);
}

async function testUnderground0Gap2() {
    const backend = await setup();

    backend.createGameObject(GameObject.RAMP_UP, {x: 1, y: 0, direction: Direction.LEFT});
    backend.createGameObject(GameObject.RAMP_DOWN, {x: 2, y: 0, direction: Direction.LEFT, rampParent: 1n});

    assert(backend.exec("SELECT 1 FROM BeltPath WHERE id=2 AND length=(2*2-1)"), 1);
}

async function testUndergroundBelt2() {
    const backend = await setup();

    backend.createGameObject(GameObject.BELT, {x: 10, y: 0, direction: Direction.DOWN});
    backend.createGameObject(GameObject.BELT, {x: 10, y: 1, direction: Direction.DOWN});
    backend.createGameObject(GameObject.BELT, {x: 10, y: 2, direction: Direction.DOWN});

    backend.createGameObject(GameObject.BELT, {x: 12, y: 1, direction: Direction.LEFT});
    backend.createGameObject(GameObject.RAMP_DOWN, {x: 11, y: 1, direction: Direction.LEFT});
    backend.createGameObject(GameObject.RAMP_UP, {x: 9, y: 1, direction: Direction.LEFT, rampParent: 5n});
    backend.createGameObject(GameObject.BELT, {x: 8, y: 1, direction: Direction.LEFT});

    assert(backend.exec("SELECT 1 FROM BeltPath WHERE id=1 AND length=(3*2-1)"), 1);
    assert(backend.exec("SELECT 1 FROM BeltPath WHERE id=4 AND length=(5*2-1)"), 1);
}

async function testUndergroundBeltMaxLen() {
    const backend = await setup();
    backend.createGameObject(GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.RAMP_UP, {x: 1 + MAX_UNDERGROUND_LENGTH + 1, y: 1, direction: Direction.RIGHT, rampParent: 1n});
    assert(backend.exec(`SELECT 1 FROM BeltPath WHERE id=1 AND length=${(MAX_UNDERGROUND_LENGTH + 2)*2-1}`), 1);
}

async function testUndergroundBeltMaxLen2() {
    const backend = await setup();
    backend.createGameObject(GameObject.RAMP_UP, {x: 1 + MAX_UNDERGROUND_LENGTH + 1, y: 1, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    assert(backend.exec(`SELECT 1 FROM BeltPath WHERE id=${MAX_UNDERGROUND_LENGTH + 2} AND length=${(MAX_UNDERGROUND_LENGTH + 2)*2-1}`), 1);
    assert(backend.exec("SELECT COUNT(*) FROM BeltPath"), 1);
}

async function testUndergroundBeltTooLong() {
    const backend = await setup();
    backend.createGameObject(GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.RAMP_UP, {x: 1 + MAX_UNDERGROUND_LENGTH + 2, y: 1, direction: Direction.RIGHT, rampParent: 1n});
    assert(backend.exec(`SELECT 1 FROM BeltPath WHERE id=1 AND length=${(MAX_UNDERGROUND_LENGTH + 3)*2-1}`), undefined);
}

async function testUndergroundBeltTooLong2() {
    const backend = await setup();
    backend.createGameObject(GameObject.RAMP_UP, {x: 1 + MAX_UNDERGROUND_LENGTH + 2, y: 1, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    assert(backend.exec(`SELECT 1 FROM BeltPath WHERE id=${MAX_UNDERGROUND_LENGTH + 3} AND length=${(MAX_UNDERGROUND_LENGTH + 3)*2-1}`), undefined);
    assert(backend.exec("SELECT COUNT(*) FROM BeltPath"), 2);
}

async function testUndergroundBeltDeleteUpRamp() {
    const backend = await setup();
    backend.createGameObject(GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.RAMP_UP, {x: 3, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    backend.removeGameObject(GameObject.BELT, 3n);

    assert(backend.exec("SELECT 1 FROM BeltPath WHERE id=1 AND length=1"), 1);
    assert(backend.exec("SELECT COUNT(*) FROM Belt"), 1);
    assert(backend.exec("SELECT COUNT(*) FROM BeltPath"), 1);
}

async function testUndergroundBeltDeleteDownRamp() {
    const backend = await setup();
    backend.createGameObject(GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.RAMP_UP, {x: 3, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    backend.removeGameObject(GameObject.BELT, 1n);

    assert(backend.exec("SELECT 1 FROM BeltPath WHERE id=3 AND length=1"), 1);
    assert(backend.exec("SELECT COUNT(*) FROM Belt"), 1);
    assert(backend.exec("SELECT COUNT(*) FROM BeltPath"), 1);
}

async function testUndergroundBeltDeleteDownRamp2() {
    const backend = await setup();
    backend.createGameObject(GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.RAMP_UP, {x: 3, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    backend.exec("UPDATE Port SET item=1 WHERE id=(SELECT in_port FROM BeltPath WHERE id=1)");
    backend.tickBeltPath();

    assert(backend.exec("SELECT 1 FROM BeltPath WHERE id=1 AND length=(3*2-1) AND head_gap=0"), 1);

    backend.removeGameObject(GameObject.BELT, 3n);

    assert(backend.exec("SELECT 1 FROM BeltPathItem WHERE path=1 AND type=1"), 1);
    assert(backend.exec("SELECT 1 FROM BeltPath WHERE id=1 AND length=1 AND head_gap=0"), 1);
    assert(backend.exec("SELECT COUNT(*) FROM Belt"), 1);
    assert(backend.exec("SELECT COUNT(*) FROM BeltPath"), 1);
}

async function testUndergroundBeltDeleteDownRamp3() {
    const backend = await setup();
    backend.createGameObject(GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.RAMP_UP, {x: 3, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    backend.exec("UPDATE Port SET item=1 WHERE id=(SELECT in_port FROM BeltPath WHERE id=1)");
    backend.tickBeltPath();
    backend.tickBeltPath();

    assert(backend.exec("SELECT 1 FROM BeltPath WHERE id=1 AND length=(3*2-1) AND head_gap=1"), 1);

    backend.removeGameObject(GameObject.BELT, 3n);

    assert(backend.exec("SELECT 1 FROM BeltPath WHERE id=1 AND length=1 AND head_gap=1"), 1);
    assert(backend.exec("SELECT COUNT(*) FROM Belt"), 1);
    assert(backend.exec("SELECT COUNT(*) FROM BeltPath"), 1);
    assert(backend.exec("SELECT 1 FROM BeltPathItem"), undefined);
}

async function testUndergroundBeltDeleteDownRamp0Gap() {
    const backend = await setup();
    backend.createGameObject(GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.RAMP_UP, {x: 2, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    backend.removeGameObject(GameObject.BELT, 1n);

    assert(backend.exec("SELECT 1 FROM BeltPath WHERE id=2 AND length=1"), 1);
    assert(backend.exec("SELECT COUNT(*) FROM Belt"), 1);
    assert(backend.exec("SELECT COUNT(*) FROM BeltPath"), 1);
}

async function testUndergroundBeltDeleteUpRamp0Gap() {
    const backend = await setup();
    backend.createGameObject(GameObject.RAMP_DOWN, {x: 1, y: 1, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.RAMP_UP, {x: 2, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    backend.removeGameObject(GameObject.BELT, 2n);

    assert(backend.exec("SELECT 1 FROM BeltPath WHERE id=1 AND length=1"), 1);
    assert(backend.exec("SELECT COUNT(*) FROM Belt"), 1);
    assert(backend.exec("SELECT COUNT(*) FROM BeltPath"), 1);
}

async function testUndergroundBeltCrossChunk0Gap() {
    const backend = await setup();
    backend.createGameObject(GameObject.RAMP_DOWN, {x: -1, y: 1, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.RAMP_UP, {x: 0, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    assert(backend.exec("SELECT (SELECT out_port FROM BeltPath WHERE id=1) = (SELECT in_port FROM BeltPath WHERE id=2)"), 1);

    backend.exec("UPDATE Port SET item=1 WHERE id=(SELECT in_port FROM BeltPath WHERE id=1)");
    backend.tickBeltPath();
    backend.tickBeltPath();

    assert(backend.exec("SELECT 1 FROM BeltPathItem WHERE path=2"), 1);
    backend.tickBeltPath();
    assert(backend.exec("SELECT 1 FROM Port WHERE id=(SELECT out_port FROM BeltPath WHERE id=2) AND item=1"), 1);

    backend.removeGameObject(GameObject.BELT, 1n);

    assert(backend.exec("SELECT (SELECT out_port FROM BeltPath WHERE id=1) = (SELECT in_port FROM BeltPath WHERE id=2)"), null);
    assert(backend.exec("SELECT 1 FROM BeltPath WHERE in_port IS NULL OR out_port IS NULL"), undefined);

    assert(backend.exec("SELECT 1 FROM BeltPath WHERE id=2 AND length=1"), 1);
    assert(backend.exec("SELECT COUNT(*) FROM Belt"), 1);
    assert(backend.exec("SELECT COUNT(*) FROM BeltPath"), 1);
}

async function testUndergroundBeltCrossChunk1() {
    const backend = await setup();
    backend.createGameObject(GameObject.RAMP_DOWN, {x: -1, y: 1, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.RAMP_UP, {x: 1, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    assert(backend.exec("SELECT (SELECT out_port FROM BeltPath WHERE id=1) = (SELECT in_port FROM BeltPath WHERE id=2)"), 1);
    assert(backend.exec("SELECT 1 FROM BeltPath WHERE id=1 AND length=1"), 1);
    assert(backend.exec("SELECT 1 FROM BeltPath WHERE id=2 AND length=(2*2-1)"), 1);

    // Item travel
    backend.exec("UPDATE Port SET item=1 WHERE id=(SELECT in_port FROM BeltPath WHERE id=1)");
    backend.tickBeltPath();
    backend.tickBeltPath();
    backend.tickBeltPath();

    assert(backend.exec("SELECT 1 FROM BeltPathItem WHERE path=2"), 1);
}

async function testUndergroundBeltCrossChunk2() {
    const backend = await setup();
    backend.createGameObject(GameObject.RAMP_DOWN, {x: -2, y: 1, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.RAMP_UP, {x: 0, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    assert(backend.exec("SELECT (SELECT out_port FROM BeltPath WHERE id=1) = (SELECT in_port FROM BeltPath WHERE id=3)"), 1);
    assert(backend.exec("SELECT 1 FROM BeltPath WHERE id=1 AND length=(2*2-1)"), 1);
    assert(backend.exec("SELECT 1 FROM BeltPath WHERE id=3 AND length=1"), 1);
}

async function testUndergroundBeltCrossChunk3() {
    const backend = await setup();
    backend.createGameObject(GameObject.RAMP_DOWN, {x: -2, y: 1, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.RAMP_UP, {x: 1, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    assert(backend.exec("SELECT (SELECT out_port FROM BeltPath WHERE id=1) = (SELECT in_port FROM BeltPath WHERE id=3)"), 1);
    assert(backend.exec("SELECT 1 FROM BeltPath WHERE id=1 AND length=(2*2-1)"), 1);
    assert(backend.exec("SELECT 1 FROM BeltPath WHERE id=3 AND length=(2*2-1)"), 1);
}

async function testUndergroundBeltCrossChunk4() {
    const backend = await setup();
    backend.createGameObject(GameObject.RAMP_UP, {x: 1, y: 1, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.RAMP_DOWN, {x: -2, y: 1, direction: Direction.RIGHT, rampParent: 1n});

    assert(backend.exec("SELECT (SELECT out_port FROM BeltPath WHERE id=4) = (SELECT in_port FROM BeltPath WHERE id=3)"), 1);
    assert(backend.exec("SELECT 1 FROM BeltPath WHERE id=4 AND length=(2*2-1)"), 1);
    assert(backend.exec("SELECT 1 FROM BeltPath WHERE id=3 AND length=(2*2-1)"), 1);
}

async function testRampConnection1() {

    const backend = await setup();
    backend.createGameObject(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.RAMP_DOWN, {x: 1, y: 0, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.BELT, {x: 2, y: 0, direction: Direction.RIGHT});

    assert(backend.exec("SELECT 1 FROM BeltPath WHERE id=1 AND length=(2*2-1)"), 1);
    assert(backend.exec("SELECT 1 FROM BeltPath WHERE id=3 AND length=1"), 1);
}

async function testRampConnection2() {

    const backend = await setup();
    backend.createGameObject(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.RAMP_UP, {x: 1, y: 0, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.BELT, {x: 2, y: 0, direction: Direction.RIGHT});

    assert(backend.exec("SELECT 1 FROM BeltPath WHERE id=1 AND length=1"), 1);
    assert(backend.exec("SELECT 1 FROM BeltPath WHERE id=2 AND length=(2*2-1)"), 1);
}

async function testRampConnection3() {
    const backend = await setup();

    // Belt -> Ramp
    backend.createGameObject(GameObject.BELT, {x: 0, y: 0, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.RAMP_UP, {x: 1, y: 0, direction: Direction.UP});

    backend.createGameObject(GameObject.BELT, {x: 0, y: 2, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.RAMP_UP, {x: 1, y: 2, direction: Direction.DOWN});

    backend.createGameObject(GameObject.BELT, {x: 0, y: 4, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.RAMP_DOWN, {x: 1, y: 4, direction: Direction.UP});

    backend.createGameObject(GameObject.BELT, {x: 0, y: 6, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.RAMP_DOWN, {x: 1, y: 6, direction: Direction.DOWN});

    // Belt -> ramp (reverse order
    backend.createGameObject(GameObject.RAMP_UP, {x: 1, y: 24, direction: Direction.UP});
    backend.createGameObject(GameObject.BELT, {x: 0, y: 24, direction: Direction.RIGHT});

    backend.createGameObject(GameObject.RAMP_UP, {x: 1, y: 26, direction: Direction.DOWN});
    backend.createGameObject(GameObject.BELT, {x: 0, y: 26, direction: Direction.RIGHT});

    backend.createGameObject(GameObject.RAMP_DOWN, {x: 1, y: 28, direction: Direction.UP});
    backend.createGameObject(GameObject.BELT, {x: 0, y: 28, direction: Direction.RIGHT});

    backend.createGameObject(GameObject.RAMP_DOWN, {x: 1, y: 30, direction: Direction.DOWN});
    backend.createGameObject(GameObject.BELT, {x: 0, y: 30, direction: Direction.RIGHT});

    // Ramp -> Belt

    backend.createGameObject(GameObject.BELT, {x: 1, y: 12, direction: Direction.UP});
    backend.createGameObject(GameObject.RAMP_DOWN, {x: 0, y: 12, direction: Direction.RIGHT});

    backend.createGameObject(GameObject.BELT, {x: 1, y: 14, direction: Direction.DOWN});
    backend.createGameObject(GameObject.RAMP_DOWN, {x: 0, y: 14, direction: Direction.RIGHT});

    // Ramp -> Belt (reverse order)

    backend.createGameObject(GameObject.RAMP_DOWN, {x: 0, y: 20, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.BELT, {x: 1, y: 20, direction: Direction.UP});

    backend.createGameObject(GameObject.RAMP_DOWN, {x: 0, y: 22, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.BELT, {x: 1, y: 22, direction: Direction.DOWN});

    assert(backend.exec(`SELECT COUNT(*) FROM BeltPath WHERE length=1`), 24);

    backend.createGameObject(GameObject.RAMP_UP, {x: 0, y: 16, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.BELT, {x: 1, y: 16, direction: Direction.UP});

    backend.createGameObject(GameObject.RAMP_UP, {x: 0, y: 18, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.BELT, {x: 1, y: 18, direction: Direction.DOWN});

    assert(backend.exec(`SELECT COUNT(*) FROM BeltPath WHERE length=(2*2-1)`), 2);

    backend.createGameObject(GameObject.BELT, {x: 1, y: 10, direction: Direction.DOWN});
    backend.createGameObject(GameObject.RAMP_UP, {x: 0, y: 10, direction: Direction.RIGHT});

    assert(backend.exec(`SELECT COUNT(*) FROM BeltPath WHERE length=(2*2-1)`), 3);

    backend.createGameObject(GameObject.BELT, {x: 1, y: 8, direction: Direction.UP});
    backend.createGameObject(GameObject.RAMP_UP, {x: 0, y: 8, direction: Direction.RIGHT});

    assert(backend.exec(`SELECT COUNT(*) FROM BeltPath WHERE length=(2*2-1)`), 4);
}

async function testDisconnectRamp() {
    const backend = await setup();

    backend.createGameObject(GameObject.RAMP_DOWN, {x: 0, y: 0, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.RAMP_UP, {x: 3, y: 0, direction: Direction.RIGHT, rampParent: 1n});

    assert(backend.exec(`SELECT COUNT(*) FROM Belt WHERE type=${BeltType.UNDERGROUND}`), 2);


    assertThrowsError(() => {
        backend.createGameObject(GameObject.RAMP_UP, {x: 1, y: 0, direction: Direction.RIGHT, rampParent: 1n});
    });

    assertThrowsError(() => {
        backend.createGameObject(GameObject.RAMP_UP, {x: 1, y: 0, direction: Direction.RIGHT, rampParent: 1n, disconnectRampChild: 1n });
    });

    assertThrowsError(() => {
        // Missing ramp parent
        backend.createGameObject(GameObject.RAMP_UP, {x: 1, y: 0, direction: Direction.RIGHT, disconnectRampChild: 1n});
    });

    assertThrowsError(() => {
        // Bad object type
        backend.createGameObject(GameObject.BELT, {x: 1, y: 0, direction: Direction.RIGHT, rampParent: 1n, disconnectRampChild: 4n});
    });

    backend.createGameObject(GameObject.RAMP_UP, {x: 1, y: 0, direction: Direction.RIGHT, rampParent: 1n, disconnectRampChild: 4n});

    assert(backend.exec(`SELECT COUNT(*) FROM Belt WHERE type=${BeltType.UNDERGROUND}`), 0);
}

async function testDisconnectRampCrossChunk() {

    const backend = await setup();
    backend.createGameObject(GameObject.RAMP_DOWN, {x: -2, y: 0, direction: Direction.RIGHT});
    backend.createGameObject(GameObject.RAMP_UP, {x: 2, y: 0, direction: Direction.RIGHT, rampParent: 1n});

    assert(backend.exec(`SELECT COUNT(*) FROM Belt WHERE type=${BeltType.UNDERGROUND}`), 3);

    backend.createGameObject(GameObject.RAMP_UP, {x: 1, y: 0, direction: Direction.RIGHT, rampParent: 1n, disconnectRampChild: 5n});

    assert(backend.exec(`SELECT COUNT(*) FROM Belt WHERE type=${BeltType.UNDERGROUND}`), 2);
}


export default async function test() {
    await executeTests("belt", {
        testBeltParent,
        testBeltLink,
        testBeltLinkDeleteChild,
        testBeltLinkDeleteParent,
        testBeltCreate1,
        testBeltCreate2,
        testBeltCreate3,
        testBeltCreate4,
        testBeltCreateLoop,
        testBeltDeleteStash1,
        testBeltDeleteStash2,
        testBeltDeleteStash3,
        testBeltDeleteCreateStash,
        testBeltTickCase0,
        testBeltTick1Item,
        testBeltTick2Items,
        testUndergroundBelt1,
        testUndergroundBelt2,
        testUnderground0Gap,
        testUnderground0Gap2,
        testUndergroundBeltMaxLen,
        testUndergroundBeltMaxLen2,
        testUndergroundBeltTooLong,
        testUndergroundBeltTooLong2,
        testUndergroundBeltDeleteDownRamp,
        testUndergroundBeltDeleteDownRamp2,
        testUndergroundBeltDeleteDownRamp3,
        testUndergroundBeltDeleteUpRamp,
        testUndergroundBeltDeleteDownRamp0Gap,
        testUndergroundBeltDeleteUpRamp0Gap,
        testUndergroundBeltCrossChunk0Gap,
        testUndergroundBeltCrossChunk1,
        testUndergroundBeltCrossChunk2,
        testUndergroundBeltCrossChunk3,
        testUndergroundBeltCrossChunk4,
        testRampConnection1,
        testRampConnection2,
        testRampConnection3,
        testDisconnectRamp,
        testDisconnectRampCrossChunk,
    });
}