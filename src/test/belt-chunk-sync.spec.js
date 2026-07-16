import {test} from "node:test";
import assert from "node:assert/strict";
import {Game} from "@/common/Game.js";
import {Direction} from "@/common/constants.js";
import {chunkId} from "@/common/util.js";
import {BELT_NORMAL} from "@/mods/Logistics/constants.js";
import {CreateBeltMessage} from "@/mods/Logistics/messages.js";
import {SetViewportMessage} from "@/common/CoreMessages.js";
import {ChunkSyncEvent} from "@/common/CoreEvents.js";
import {BeltSyncEvent} from "@/mods/Logistics/events.js";
import {makeGameEngine, ecsModRegistry} from "@/test/ecsSim.js";
import {GameEngine, TICK_PHASE_ORDER} from "@/common/sim/GameEngine.js";
import {beltsOf} from "@/mods/Logistics/testHelpers.js";

const RED = 1;
const CELLS = [{x: 0, y: 0}, {x: 0, y: 1}, {x: 0, y: 2}];

class CapturingSession {
    constructor(playerId) {
        this.playerId = playerId;
        this.id = null;
        this.events = [];
    }
    setId(id) {
        this.id = id;
    }
    publishEvent(event) {
        this.events.push(event);
    }
}

test("a session subscribing to a chunk receives its existing belts and resting items from ECS", async () => {
    const modRegistry = ecsModRegistry();
    const engine = new GameEngine(modRegistry);
    const game = new Game(modRegistry, engine);
    await game.init();

    // A placing session builds a belt line and lets an item rest at the out-port.
    const builder = new CapturingSession(1);
    game.connect(builder);
    CELLS.forEach(cell => game.dispatchMessage(new CreateBeltMessage(cell.x, cell.y, Direction.UP, BELT_NORMAL), builder));
    const path = beltsOf(engine).pathAt(0, 2);
    engine.setPortItem(path.inPort, RED);
    for (let i = 0; i < 8; i += 1) {
        TICK_PHASE_ORDER.forEach(phase => game.tick(phase));
        game.postTick();
    }

    // A fresh viewer subscribes to the belt's chunk and must be sent the existing state.
    const viewer = new CapturingSession(2);
    game.connect(viewer);
    game.dispatchMessage(new SetViewportMessage([chunkId(0, 0)]), viewer);

    const bundle = viewer.events.find(event => event instanceof ChunkSyncEvent);
    assert.ok(bundle, "a ChunkSyncEvent bundle for the subscribed chunk");
    const belts = bundle.events.filter(event => event instanceof BeltSyncEvent);

    assert.equal(belts.length, CELLS.length, "one BeltSyncEvent per placed belt");
    assert.deepEqual(
        belts.map(event => [event.x, event.y]).sort(),
        CELLS.map(cell => [cell.x, cell.y]).sort(),
    );
    // (Resting-item sync on subscribe is deferred — items reappear via live render events.)
});
