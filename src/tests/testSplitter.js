import {assert, executeTests, setup} from "@/tests/common.js";
import {GameObject} from "@/backend/constants.js";

async function testCreate1() {
    const backend = await setup();

    backend.createGameObject(GameObject.Splitter, {x: 0, y: 0, direction: 0});

    assert(backend.exec("SELECT 1 FROM Splitter WHERE in_port_a=1 AND in_port_b=2 AND out_port_a=3 AND out_port_b=4"), 1);
}

async function testCreate2() {
    const backend = await setup();

    backend.createGameObject(GameObject.BELT, {x: 0, y: 5, direction: 0});
    backend.createGameObject(GameObject.Splitter, {x: 0, y: 4, direction: 0});

    assert(backend.exec("SELECT 1 FROM BeltPath WHERE out_port=2"), 1);
    assert(backend.exec("SELECT 1 FROM Splitter WHERE in_port_a=2 AND in_port_b != 2"), 1);
}

async function testBeltAttachInput() {
    const backend = await setup();

    backend.createGameObject(GameObject.Splitter, {x: 0, y: 4, direction: 0});
    backend.createGameObject(GameObject.BELT, {x: 0, y: 5, direction: 0});

    assert(backend.exec("SELECT 1 FROM Splitter WHERE in_port_a=1"), 1);
    assert(backend.exec("SELECT 1 FROM BeltPath WHERE out_port=1"), 1);
}

async function testBeltAttachOutput() {
    const backend = await setup();

    backend.createGameObject(GameObject.Splitter, {x: 0, y: 4, direction: 0});
    backend.createGameObject(GameObject.BELT, {x: 0, y: 3, direction: 0});

    assert(backend.exec("SELECT 1 FROM Splitter WHERE out_port_a=3"), 1);
    assert(backend.exec("SELECT 1 FROM BeltPath WHERE in_port=3 AND id=1"), 1);

    backend.removeGameObject(GameObject.BELT, 1n);

    assert(backend.exec("SELECT 1 FROM Splitter WHERE out_port_a=3"), 1);
}

export default async function test() {
    await executeTests("splitter", {
        testCreate1,
        testCreate2,
        testBeltAttachInput,
        testBeltAttachOutput
    });
}
