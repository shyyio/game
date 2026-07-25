import {test} from "node:test";
import assert from "node:assert/strict";
import {Game} from "@/sim/Game.js";
import {Direction} from "@/common/constants.js";
import {chunkId} from "@/common/util.js";
import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {BeltDefinition} from "@/mods/Logistics/common/objectTypes.js";
import {SetViewportMessage} from "@/common/CoreMessages.js";
import {ecsModRegistry} from "@/test/ecsSim.js";
import {GameEngine, TICK_PHASE_ORDER} from "@/sim/GameEngine.js";
import {PortItemSetEvent, PortItemBatchEvent} from "@/common/PortItemEvents.js";
import {beltsOf} from "@/mods/Logistics/sim/testHelpers.js";
import {CapturingSession} from "@/test/CapturingSession.js";

const RED = 1;
const CELLS = [{x: 0, y: 0}, {x: 0, y: 1}, {x: 0, y: 2}];

test("a Game on GameEngine routes belt render events only to sessions watching the chunk", async () => {
    const modRegistry = ecsModRegistry();
    const engine = new GameEngine(modRegistry);
    const game = new Game(modRegistry, engine);
    await game.init();

    const watcher = new CapturingSession(1);
    const bystander = new CapturingSession(2);
    game.connect(watcher);
    game.connect(bystander);

    const beltChunk = chunkId(0, 0);
    const elsewhere = chunkId(1000, 1000);
    game.dispatchMessage(new SetViewportMessage([beltChunk]), watcher);
    game.dispatchMessage(new SetViewportMessage([elsewhere]), bystander);

    for (const cell of CELLS) {
        game.dispatchMessage(new CreateObjectMessage(BeltDefinition.typeId, cell.x, cell.y, Direction.UP), watcher);
    }

    // Feed an item; do not drain, so it pops and rests at the out-port (tail tile 0,0).
    const path = beltsOf(engine).pathAt(0, 2);
    engine.setPortItem(path.inPort, RED);
    for (let i = 0; i < 8; i += 1) {
        for (const phase of TICK_PHASE_ORDER) {
            game.tick(phase);
        }
        game.postTick();
    }

    // Port deltas arrive batched per chunk; unpack them the way a client does.
    const portItems = events => events
        .filter(event => event instanceof PortItemBatchEvent)
        .flatMap(batch => batch.explode());
    const watcherRenders = portItems(watcher.events);
    const bystanderRenders = portItems(bystander.events);

    assert.ok(watcherRenders.some(event => event instanceof PortItemSetEvent && event.itemType === RED), "watcher gets the item's render set");
    assert.equal(bystanderRenders.length, 0, "the bystander (different chunk) gets no belt render events");
});
