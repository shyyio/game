import {EMPTY} from "@/sim/AbstractComponent.js";
import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {ModPackage} from "@/common/ModPackage.js";
import {makeGameEngine} from "@/test/ecsSim.js";
import {EventCollector} from "@/test/EventCollector.js";
import {LaneItemUpsertEvent} from "@/common/LaneEvents.js";
import {PortItemSetEvent} from "@/common/PortItemEvents.js";
import {
    LaneFixtureDeclaration,
    ITEM_TYPE_TEST_CARGO,
    placeLane,
    getLaneRefAt,
} from "@/test/laneFixture.js";

const CARGO = ITEM_TYPE_TEST_CARGO;

async function setup() {
    return makeGameEngine([new ModPackage(new LaneFixtureDeclaration())]);
}

/**
 * Ticks until the port holds an item, or the budget runs out.
 * @param {GameEngine} engine
 * @param {number} portEid
 * @param {number} budget
 * @returns {void}
 */
function tickUntilPortFilled(engine, portEid, budget) {
    for (let i = 0; i < budget && engine.ports.getItemByPortEid(portEid) === EMPTY; i += 1) {
        engine.tick();
    }
}

// An item ages while it rides: it is the tick it was made on that travels, not a fresh stamp per hop.
test("an item keeps its birth tick riding a lane", async () => {
    const engine = await setup();
    for (const y of [0, 1, 2]) {
        placeLane(engine, 0, y, Direction.UP);
    }
    const lane = getLaneRefAt(engine, 0, 2);
    const inputPort = engine.lanes.getInputPortEidByLaneRef(lane);
    const outputPort = engine.lanes.getOutputPortEidByLaneRef(lane);
    engine.tick();
    const birthTick = engine.clock;
    engine.ports.setItem(inputPort, CARGO, birthTick);

    tickUntilPortFilled(engine, outputPort, 8);

    assert.equal(engine.ports.getItemByPortEid(outputPort), CARGO);
    assert.equal(engine.ports.getBirthTickByPortEid(outputPort), birthTick);
});

// A lane is never edited in place: a merge rebuilds it and re-ingests the item resting in the old
// output port, which is now interior. The item's age has to survive that.
test("an item keeps its birth tick through a lane merge", async () => {
    const engine = await setup();
    placeLane(engine, 0, 0, Direction.RIGHT);
    placeLane(engine, 1, 0, Direction.RIGHT);
    placeLane(engine, 2, 0, Direction.RIGHT);
    placeLane(engine, 4, 0, Direction.RIGHT);
    engine.tick();
    const birthTick = engine.clock;
    engine.ports.setItem(engine.lanes.getOutputPortEidByLaneRef(getLaneRefAt(engine, 0, 0)), CARGO, birthTick);

    placeLane(engine, 3, 0, Direction.RIGHT);
    const merged = getLaneRefAt(engine, 0, 0);
    const outputPort = engine.lanes.getOutputPortEidByLaneRef(merged);
    tickUntilPortFilled(engine, outputPort, 12);

    assert.equal(engine.ports.getItemByPortEid(outputPort), CARGO);
    assert.equal(engine.ports.getBirthTickByPortEid(outputPort), birthTick);
});

// The client cannot derive when an item was made, so every item row carries it; the client ages it
// against the clock the tick heartbeat already brings.
test("an item row carries the item's birth tick", async () => {
    const engine = await setup();
    const collector = new EventCollector(engine);
    for (const y of [0, 1, 2]) {
        placeLane(engine, 0, y, Direction.UP);
    }
    const lane = getLaneRefAt(engine, 0, 2);
    engine.tick();
    const birthTick = engine.clock;
    collector.drain();
    engine.ports.setItem(engine.lanes.getInputPortEidByLaneRef(lane), CARGO, birthTick);

    const upserts = [];
    for (let i = 0; i < 8; i += 1) {
        engine.tick();
        for (const event of collector.drain()) {
            if (event instanceof LaneItemUpsertEvent) {
                upserts.push(event);
            }
        }
    }

    assert.ok(upserts.length > 0, "the item is upserted");
    assert.ok(upserts.every(event => event.birthTick === birthTick), "every row carries the birth tick");
});

// An item resting in a rendered output port is drawn too, so its set row carries its age as well.
test("a port item row carries the item's birth tick", async () => {
    const engine = await setup();
    const collector = new EventCollector(engine);
    for (const y of [0, 1, 2]) {
        placeLane(engine, 0, y, Direction.UP);
    }
    const lane = getLaneRefAt(engine, 0, 2);
    const outputPort = engine.lanes.getOutputPortEidByLaneRef(lane);
    engine.tick();
    const birthTick = engine.clock;
    collector.drain();
    engine.ports.setItem(engine.lanes.getInputPortEidByLaneRef(lane), CARGO, birthTick);

    const sets = [];
    for (let i = 0; i < 8 && engine.ports.getItemByPortEid(outputPort) === EMPTY; i += 1) {
        engine.tick();
        for (const event of collector.drain()) {
            if (event instanceof PortItemSetEvent) {
                sets.push(event);
            }
        }
    }

    assert.ok(sets.length > 0, "the resting item is set");
    assert.ok(sets.every(event => event.birthTick === birthTick), "every set carries the birth tick");
});
