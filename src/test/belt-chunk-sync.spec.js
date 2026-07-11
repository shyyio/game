import {test} from "node:test";
import assert from "node:assert/strict";
import {ModRegistry} from "@/common/ModRegistry.js";
import {DatabaseSchema} from "@/common/DatabaseSchema.js";
import {NodeDatabase} from "@/server/NodeDatabase.js";
import {Game} from "@/common/Game.js";
import {Direction} from "@/common/constants.js";
import {chunkId} from "@/common/util.js";
import {BELT_NORMAL} from "@/mods/Logistics/constants.js";
import {CreateBeltMessage} from "@/mods/Logistics/messages.js";
import {SetViewportMessage} from "@/common/CoreMessages.js";
import {LogisticsMod} from "@/mods/Logistics/mod.js";
import {EcsSimEngine} from "@/common/sim/EcsSimEngine.js";
import {TICK_PHASE_ORDER} from "@/common/sim/SimEngine.js";

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
    const modRegistry = new ModRegistry();
    modRegistry.loadMod(new LogisticsMod());
    const db = new NodeDatabase(new DatabaseSchema(modRegistry));
    const engine = new EcsSimEngine();
    const game = new Game(modRegistry, db, engine);
    await game.init();

    // A placing session builds a belt line and lets an item rest at the out-port.
    const builder = new CapturingSession(1);
    game.connect(builder);
    CELLS.forEach(cell => game.dispatchMessage(new CreateBeltMessage(cell.x, cell.y, Direction.UP, BELT_NORMAL), builder));
    const path = engine.belts.pathAt(0, 2);
    engine.engine.setPortItem(path.inPort, RED);
    for (let i = 0; i < 8; i += 1) {
        TICK_PHASE_ORDER.forEach(phase => game.tick(phase));
        game.postTick();
    }

    // A fresh viewer subscribes to the belt's chunk and must be sent the existing state.
    const viewer = new CapturingSession(2);
    game.connect(viewer);
    game.dispatchMessage(new SetViewportMessage([chunkId(0, 0)]), viewer);

    const belts = viewer.events.filter(event => event.kind === "belt");
    const sets = viewer.events.filter(event => event.kind === "set");

    assert.equal(belts.length, CELLS.length, "one belt sync event per placed belt");
    assert.deepEqual(
        belts.map(event => [event.x, event.y]).sort(),
        CELLS.map(cell => [cell.x, cell.y]).sort(),
    );
    assert.ok(sets.some(event => event.item === RED && event.x === 0 && event.y === 0), "the resting item is synced");
});
