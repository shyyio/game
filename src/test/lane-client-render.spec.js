import {EMPTY} from "@/sim/AbstractComponent.js";
import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction, LAYER_SURFACE} from "@/common/constants.js";
import {chunkKeyAt} from "@/common/util.js";
import {CreateObjectMessage, DeleteObjectMessage, SetViewportMessage} from "@/common/CoreMessages.js";
import {ClaimChunkMessage} from "@/common/ClaimMessages.js";
import {AbstractBatchEvent} from "@/common/AbstractBatchEvent.js";
import {ChunkSyncEvent} from "@/common/CoreEvents.js";
import {ObjectInsertEvent, ObjectSyncEvent, ObjectDeleteEvent} from "@/common/ObjectEvents.js";
import {LaneItemDeleteEvent} from "@/common/LaneEvents.js";
import {Game} from "@/sim/Game.js";
import {GameEngine} from "@/sim/GameEngine.js";
import {ecsModRegistry} from "@/test/ecsSim.js";
import {CapturingSession} from "@/test/CapturingSession.js";
import {BeltType} from "@/mods/logistics/common/objectTypes.js";
import {LaneItemDrawLayer} from "@/client/layers/LaneItemDrawLayer.js";

const RED = 1;
// What blocks an output port so a lane packs solid behind it.
const PLUG = 2;
const COLUMN_X = 5;

/**
 * The object index as LaneItemDrawLayer reads it, fed from the object events the way the client's
 * cache is: a cell is known only once its insert or sync has arrived.
 */
class ReplayCache {

    constructor(modRegistry) {
        this._modRegistry = modRegistry;
        this._entries = new Map();
        this._setListeners = [];
        this._removeListeners = [];
    }

    get(objectRef) {
        const entry = this._entries.get(objectRef);
        if (entry === undefined) {
            return null;
        }
        return entry;
    }

    onSet(listener) {
        this._setListeners.push(listener);
    }

    onRemove(listener) {
        this._removeListeners.push(listener);
    }

    onStructuralChange(listener) {

    }

    onUpdate(listener) {

    }

    /**
     * @param {AbstractEvent} event
     * @returns {void}
     */
    apply(event) {
        if (event instanceof ObjectInsertEvent || event instanceof ObjectSyncEvent) {
            const entry = {
                id: event.objectRef,
                tileX: event.x,
                tileY: event.y,
                data: {type: this._modRegistry.getObjectTypeByTypeId(event.objectTypeId), direction: event.direction},
            };
            this._entries.set(event.objectRef, entry);
            for (const listener of this._setListeners) {
                listener(entry);
            }
            return;
        }
        if (event instanceof ObjectDeleteEvent) {
            const entry = this._entries.get(event.objectRef);
            this._entries.delete(event.objectRef);
            for (const listener of this._removeListeners) {
                listener(entry);
            }
        }
    }
}

/**
 * The shared item layer reduced to the sprites it would hold: key -> where and what.
 */
class ReplayItemLayer {

    constructor() {
        this.sprites = new Map();
        // Keys placed fresh without a snap since the last drain: sprites that glide in.
        this.glidedIn = new Set();
    }

    moveItem({key, tileX, tileY, halfTile, type, snap}) {
        if (!this.sprites.has(key) && snap !== true) {
            this.glidedIn.add(key);
        }
        this.sprites.set(key, {tileX, tileY, halfTile, type});
    }

    removeItem(key) {
        this.sprites.delete(key);
    }

    consumeItem(key) {
        this.sprites.delete(key);
    }
}

/**
 * A session's client side: the cache and the lane item layer, fed the session's wire traffic in
 * the order the client's EventQueue applies it (cache first, then the layers).
 */
class ReplayClient {

    /**
     * @param {Game} game
     * @param {ModRegistry} modRegistry
     * @param {number} playerRef
     */
    constructor(game, modRegistry, playerRef) {
        this.session = new CapturingSession(playerRef);
        this.cache = new ReplayCache(modRegistry);
        this.items = new ReplayItemLayer();
        this.layer = new LaneItemDrawLayer(this.items);
        this.layer.bindCache(this.cache);
        game.connect(this.session);
        game.dispatchMessage(new SetViewportMessage([chunkKeyAt(COLUMN_X, 0)]), this.session);
    }

    /**
     * Applies everything the session received since the last drain.
     * @returns {AbstractEvent[]} the events applied
     */
    drain() {
        const events = this.session.events.flatMap(event => explode(event));
        this.session.events.length = 0;
        this.items.glidedIn.clear();
        for (const event of events) {
            this.cache.apply(event);
            if (this.layer.eventClasses.some(eventClass => event instanceof eventClass)) {
                this.layer.onEvent(event);
            }
        }
        return events;
    }
}

/**
 * @param {AbstractEvent} event
 * @returns {AbstractEvent[]}
 */
function explode(event) {
    if (event instanceof ChunkSyncEvent) {
        return event.events.flatMap(inner => explode(inner));
    }
    if (event instanceof AbstractBatchEvent) {
        return event.explode().flatMap(inner => explode(inner));
    }
    return [event];
}

/**
 * The sprites the client must hold for the sim's current lanes: every item on a cell's center or
 * the edge into the next cell, and each output port's resting item one tile past the tail.
 * @param {GameEngine} engine
 * @returns {Map<string, {tileX: number, tileY: number, halfTile: boolean, type: number}>}
 */
function expectedSprites(engine) {
    const position = engine.Position;
    const sprites = new Map();
    for (const laneRef of engine.lanes.getLaneRefs()) {
        const cells = engine.lanes.getCellEidsByLaneRef(laneRef);
        const slotsPerCell = 2;
        const total = cells.length * slotsPerCell;
        let filePos = 0;
        for (const item of engine.lanes.getItemsByLaneRef(laneRef)) {
            filePos += item.gap;
            const physical = total - 2 - filePos;
            const index = Math.floor(physical / slotsPerCell);
            const halfTile = physical % slotsPerCell === 1;
            const cell = halfTile ? cells[index + 1] : cells[index];
            sprites.set(`lane:${laneRef}:${item.itemRef}`, {
                tileX: position.x[cell],
                tileY: position.y[cell],
                halfTile,
                type: item.itemTypeId,
            });
            filePos += 1;
        }
        const outputPort = engine.lanes.getOutputPortEidByLaneRef(laneRef);
        const resting = engine.ports.getItemByPortEid(outputPort);
        if (resting !== EMPTY) {
            const tail = cells[cells.length - 1];
            const direction = position.direction[tail];
            sprites.set(`lanePort:${outputPort}`, {
                tileX: position.x[tail] + Direction.dx(direction),
                tileY: position.y[tail] + Direction.dy(direction),
                halfTile: true,
                type: resting,
            });
        }
    }
    return sprites;
}

/**
 * @param {Map} sprites
 * @returns {object} sorted by key, for a deep-equal that reads well
 */
function sorted(sprites) {
    return Object.fromEntries(Array.from(sprites.entries()).sort((a, b) => a[0].localeCompare(b[0])));
}

class Scenario {

    constructor() {
        this.modRegistry = ecsModRegistry();
        this.engine = new GameEngine(this.modRegistry);
        this.game = new Game(this.modRegistry, this.engine);
    }

    async init() {
        await this.game.init();
        this.client = new ReplayClient(this.game, this.modRegistry, 1);
        this.game.dispatchMessage(new ClaimChunkMessage(chunkKeyAt(COLUMN_X, 0)), this.client.session);
        return this;
    }

    place(tileY, direction = Direction.UP, tileX = COLUMN_X) {
        this.game.dispatchMessage(new CreateObjectMessage(BeltType.objectTypeId, tileX, tileY, direction), this.client.session);
    }

    delete(tileY, tileX = COLUMN_X) {
        const eid = this.engine.placed.getEidAt(tileX, tileY, LAYER_SURFACE);
        this.game.dispatchMessage(new DeleteObjectMessage(this.engine.placed.getObjectRefByEid(eid)), this.client.session);
    }

    getLaneRefAt(tileY, tileX = COLUMN_X) {
        return this.engine.lanes.getLaneRefAt(tileX, tileY, LAYER_SURFACE);
    }

    tick(count = 1) {
        for (let i = 0; i < count; i += 1) {
            this.game.simEngine.tick();
            this.game.postTick();
        }
    }

    /**
     * Plugs a lane's output port and fills its input port until every slot holds an item.
     * @param {number} laneRef
     * @returns {void}
     */
    saturate(laneRef) {
        const lanes = this.engine.lanes;
        this.engine.ports.setItem(lanes.getOutputPortEidByLaneRef(laneRef), PLUG);
        const slots = lanes.getSlotCountByLaneRef(laneRef);
        for (let i = 0; i < slots + 2; i += 1) {
            this.engine.ports.setItem(lanes.getInputPortEidByLaneRef(laneRef), RED);
            this.tick();
        }
        assert.equal(lanes.getItemCountByLaneRef(laneRef), slots, "the lane is packed");
    }

    /**
     * The client's sprites match the sim.
     * @param {string} label
     * @returns {void}
     */
    assertState(label) {
        this.tick();
        this.client.drain();
        assert.deepEqual(sorted(this.client.items.sprites), sorted(expectedSprites(this.engine)), label);
    }

    /**
     * Right after an edit: nothing the rebuild sent glides, and the client's sprites match the sim,
     * now and after the flow moves on for a few ticks.
     * @param {string} label
     * @returns {void}
     */
    assertRendered(label) {
        // A rebuild relocates sprites: the client is right the moment its rows land, and nothing glides.
        this.client.drain();
        assert.deepEqual(Array.from(this.client.items.glidedIn), [], `${label}: the rebuild glides no sprite in`);
        assert.deepEqual(sorted(this.client.items.sprites), sorted(expectedSprites(this.engine)), `${label}, before any tick`);
        // A fresh output port sprite glides in only when it is a pop, which deletes the lane's lead
        // the same tick.
        this.tick();
        const events = this.client.drain();
        const popped = new Set(events.filter(event => event instanceof LaneItemDeleteEvent).map(event => event.laneRef));
        for (const key of this.client.items.glidedIn) {
            if (!key.startsWith("lanePort:")) {
                continue;
            }
            const laneRef = this.client.layer._laneByOutputPort.get(Number(key.slice("lanePort:".length)));
            assert.ok(popped.has(laneRef), `${label}: output port sprite ${key} glides in without a pop`);
        }
        assert.deepEqual(sorted(this.client.items.sprites), sorted(expectedSprites(this.engine)), label);
        for (const laneRef of this.engine.lanes.getLaneRefs()) {
            this.engine.ports.setItem(this.engine.lanes.getOutputPortEidByLaneRef(laneRef), EMPTY);
        }
        this.tick(3);
        this.client.drain();
        assert.deepEqual(sorted(this.client.items.sprites), sorted(expectedSprites(this.engine)), `${label}, three ticks on`);
    }
}

// A three-cell line, packed solid with its output port item resting past the tail.
async function saturatedLine() {
    const scenario = await new Scenario().init();
    for (const tileY of [10, 9, 8]) {
        scenario.place(tileY);
    }
    scenario.saturate(scenario.getLaneRefAt(10));
    scenario.assertState("the saturated line renders");
    scenario.saturate(scenario.getLaneRefAt(10));
    scenario.client.drain();
    return scenario;
}

test("extending a saturated lane downstream keeps every sprite", async () => {
    const scenario = await saturatedLine();
    scenario.place(7);
    scenario.assertRendered("after the downstream extension");
});

test("extending a saturated lane upstream keeps every sprite", async () => {
    const scenario = await saturatedLine();
    scenario.place(11);
    scenario.assertRendered("after the upstream extension");
});

test("deleting a saturated lane's tail keeps the survivors' sprites", async () => {
    const scenario = await saturatedLine();
    scenario.delete(8);
    scenario.assertRendered("after deleting the tail");
});

test("splitting a saturated lane by deleting a middle cell renders both halves", async () => {
    const scenario = await saturatedLine();
    scenario.delete(9);
    scenario.assertRendered("after the split");
});

test("deleting a saturated lane's head keeps the downstream sprites", async () => {
    const scenario = await saturatedLine();
    scenario.delete(10);
    scenario.assertRendered("after deleting the head");
});

test("a junction steal on a saturated lane renders the stolen run and the orphan", async () => {
    const scenario = await saturatedLine();
    // A newer cell parenting the middle cell's flank wins it, orphaning the head.
    scenario.place(9, Direction.LEFT, COLUMN_X + 1);
    scenario.assertRendered("after the junction steal");
});

test("filling the gap between two saturated lanes renders the merged run", async () => {
    const scenario = await new Scenario().init();
    for (const tileY of [10, 9, 7, 6]) {
        scenario.place(tileY);
    }
    scenario.saturate(scenario.getLaneRefAt(10));
    scenario.saturate(scenario.getLaneRefAt(7));
    scenario.assertState("both saturated lanes render");
    scenario.saturate(scenario.getLaneRefAt(10));
    scenario.saturate(scenario.getLaneRefAt(7));
    scenario.client.drain();
    scenario.place(8);
    scenario.assertRendered("after the merge");
});

test("re-laying a corner of a saturated run keeps its sprites", async () => {
    const scenario = await new Scenario().init();
    scenario.place(10);
    scenario.place(9);
    scenario.delete(9);
    scenario.place(9, Direction.RIGHT);
    scenario.place(9, Direction.RIGHT, COLUMN_X + 1);
    scenario.saturate(scenario.getLaneRefAt(10));
    scenario.assertState("the bent run renders");
    scenario.saturate(scenario.getLaneRefAt(10));
    scenario.client.drain();
    scenario.place(9, Direction.RIGHT, COLUMN_X + 2);
    scenario.delete(9, COLUMN_X + 2);
    scenario.place(9, Direction.UP, COLUMN_X + 2);
    scenario.assertRendered("after re-laying the far corner");
});

test("a viewer arriving at saturated lanes renders them from the chunk sync", async () => {
    const scenario = await saturatedLine();
    const viewer = new ReplayClient(scenario.game, scenario.modRegistry, 2);
    viewer.drain();
    assert.deepEqual(sorted(viewer.items.sprites), sorted(expectedSprites(scenario.engine)), "the viewer's sprites match");
});
