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
import {EcsSimEngine} from "@/common/sim/EcsSimEngine.js";
import {TICK_PHASE_ORDER} from "@/common/sim/SimEngine.js";

const RED = 1;
const CELLS = [{x: 0, y: 0}, {x: 0, y: 1}, {x: 0, y: 2}];

// A minimal session that just records the events published to it.
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

test("a Game on EcsSimEngine routes belt render events only to sessions watching the chunk", async () => {
    const modRegistry = new ModRegistry();
    modRegistry.loadMod(new (await import("@/mods/Logistics/mod.js")).LogisticsMod());
    const db = new NodeDatabase(new DatabaseSchema(modRegistry));
    const engine = new EcsSimEngine();
    const game = new Game(modRegistry, db, engine);
    await game.init();

    const watcher = new CapturingSession(1);
    const bystander = new CapturingSession(2);
    game.connect(watcher);
    game.connect(bystander);

    const beltChunk = chunkId(0, 0);
    const elsewhere = chunkId(1000, 1000);
    game.dispatchMessage(new SetViewportMessage([beltChunk]), watcher);
    game.dispatchMessage(new SetViewportMessage([elsewhere]), bystander);

    CELLS.forEach(cell => game.dispatchMessage(new CreateBeltMessage(cell.x, cell.y, Direction.UP, BELT_NORMAL), watcher));

    // Feed an item; do not drain, so it pops and rests at the out-port (tail tile 0,0).
    const path = engine.belts.pathAt(0, 2);
    engine.engine.setPortItem(path.inPort, RED);
    for (let i = 0; i < 8; i += 1) {
        TICK_PHASE_ORDER.forEach(phase => game.tick(phase));
        game.postTick();
    }

    const renderKinds = new Set(["set", "clear"]);
    const watcherRenders = watcher.events.filter(event => renderKinds.has(event.kind));
    const bystanderRenders = bystander.events.filter(event => renderKinds.has(event.kind));

    assert.ok(watcherRenders.some(event => event.kind === "set" && event.item === RED), "watcher gets the item's render set");
    assert.equal(bystanderRenders.length, 0, "the bystander (different chunk) gets no belt render events");
});
