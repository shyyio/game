import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {chunkKey} from "@/common/util.js";
import {CreateObjectMessage, SetViewportMessage} from "@/common/CoreMessages.js";
import {ClaimChunkMessage} from "@/common/ClaimMessages.js";
import {ChunkSyncEvent} from "@/common/CoreEvents.js";
import {PortItemSetEvent, PortItemBatchEvent} from "@/common/PortItemEvents.js";
import {ObjectSyncEvent} from "@/common/ObjectEvents.js";
import {LaneGeometryEvent, LaneItemSyncEvent} from "@/common/LaneEvents.js";
import {ModPackage} from "@/common/ModPackage.js";
import {Game} from "@/sim/Game.js";
import {GameEngine, TICK_PHASE_ORDER} from "@/sim/GameEngine.js";
import {ecsModRegistry} from "@/test/ecsSim.js";
import {flattenBatches} from "@/test/EventCollector.js";
import {CapturingSession} from "@/test/CapturingSession.js";
import {
    LaneFixtureDeclaration,
    TestLaneType,
    ITEM_TYPE_TEST_CARGO,
    laneAt,
} from "@/test/laneFixture.js";

const CARGO = ITEM_TYPE_TEST_CARGO;
const CELLS = [[0, 0], [0, 1], [0, 2]];

async function setup() {
    const modRegistry = ecsModRegistry([new ModPackage(new LaneFixtureDeclaration())]);
    const engine = new GameEngine(modRegistry);
    const game = new Game(modRegistry, engine);
    await game.init();
    return {game, engine};
}

function runTicks(game, count) {
    for (let i = 0; i < count; i += 1) {
        for (const phase of TICK_PHASE_ORDER) {
            game.tick(phase);
        }
        game.postTick();
    }
}

// A session subscribing to a chunk is sent everything already there: the cells, the lane geometry,
// its items, and the item resting in the out-port.
test("a session subscribing to a chunk receives its lanes, items and resting port items", async () => {
    const {game, engine} = await setup();
    const builder = new CapturingSession(1);
    game.connect(builder);
    game.dispatchMessage(new ClaimChunkMessage(chunkKey(0, 0)), builder);
    for (const cell of CELLS) {
        game.dispatchMessage(new CreateObjectMessage(TestLaneType.objectTypeId, cell[0], cell[1], Direction.UP), builder);
    }
    const lane = laneAt(engine, 0, 2);
    engine.ports.setItem(engine.lanes.inPortOf(lane), CARGO);
    runTicks(game, 2);
    const carried = engine.lanes.itemCountOf(lane);
    assert.equal(carried, 1, "one item is in flight when the viewer arrives");

    const viewer = new CapturingSession(2);
    game.connect(viewer);
    game.dispatchMessage(new SetViewportMessage([chunkKey(0, 0)]), viewer);

    const bundle = viewer.events.find(event => event instanceof ChunkSyncEvent);
    assert.ok(bundle, "a ChunkSyncEvent bundle for the subscribed chunk");
    const synced = flattenBatches(bundle.events);

    const cells = synced.filter(event => event instanceof ObjectSyncEvent && event.objectTypeId === TestLaneType.objectTypeId);
    assert.equal(cells.length, CELLS.length, "one ObjectSyncEvent per placed cell");

    const geometry = synced.filter(event => event instanceof LaneGeometryEvent);
    assert.equal(geometry.length, 1, "the lane's geometry is synced");
    assert.equal(geometry[0].laneRef, lane);

    const items = synced.filter(event => event instanceof LaneItemSyncEvent);
    assert.equal(items.length, carried, "the in-flight item is synced, snapped not glided");
});

// A resting out-port item is synced as an ordinary rendered port item.
test("a subscribing session receives a lane's resting out-port item", async () => {
    const {game, engine} = await setup();
    const builder = new CapturingSession(1);
    game.connect(builder);
    game.dispatchMessage(new ClaimChunkMessage(chunkKey(0, 0)), builder);
    for (const cell of CELLS) {
        game.dispatchMessage(new CreateObjectMessage(TestLaneType.objectTypeId, cell[0], cell[1], Direction.UP), builder);
    }
    const lane = laneAt(engine, 0, 2);
    engine.ports.setItem(engine.lanes.inPortOf(lane), CARGO);
    runTicks(game, 8);

    const viewer = new CapturingSession(2);
    game.connect(viewer);
    game.dispatchMessage(new SetViewportMessage([chunkKey(0, 0)]), viewer);

    const synced = flattenBatches(viewer.events.find(event => event instanceof ChunkSyncEvent).events);
    const portItems = synced.filter(event => event instanceof PortItemSetEvent);
    assert.equal(portItems.length, 1, "the resting out-port item is synced");
    assert.equal(portItems[0].portRef, engine.lanes.outPortOf(lane));
    assert.equal(portItems[0].itemTypeId, CARGO);
});

// Lane traffic is chunk-routed: a session watching elsewhere is told nothing.
test("lane events reach only the sessions watching the chunk", async () => {
    const {game, engine} = await setup();
    const watcher = new CapturingSession(1);
    const bystander = new CapturingSession(2);
    game.connect(watcher);
    game.connect(bystander);
    game.dispatchMessage(new SetViewportMessage([chunkKey(0, 0)]), watcher);
    game.dispatchMessage(new SetViewportMessage([chunkKey(1000, 1000)]), bystander);
    game.dispatchMessage(new ClaimChunkMessage(chunkKey(0, 0)), watcher);
    for (const cell of CELLS) {
        game.dispatchMessage(new CreateObjectMessage(TestLaneType.objectTypeId, cell[0], cell[1], Direction.UP), watcher);
    }

    const lane = laneAt(engine, 0, 2);
    engine.ports.setItem(engine.lanes.inPortOf(lane), CARGO);
    runTicks(game, 8);

    const portItems = events => events
        .filter(event => event instanceof PortItemBatchEvent)
        .flatMap(batch => batch.explode());
    assert.ok(
        portItems(watcher.events).some(event => event instanceof PortItemSetEvent && event.itemTypeId === CARGO),
        "the watcher gets the item's render set",
    );
    assert.equal(portItems(bystander.events).length, 0, "the bystander gets no lane render events");
    assert.equal(
        bystander.events.filter(event => event instanceof LaneGeometryEvent).length,
        0,
        "and no lane geometry",
    );
});
