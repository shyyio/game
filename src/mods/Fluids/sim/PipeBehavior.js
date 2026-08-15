import {AbstractBehavior} from "@spup/sdk";
import {Pipes} from "./Pipes.js";

/**
 * A pipe cell: spawn/despawn feed the shared Pipes network engine; placement is rejected when it
 * would merge same-chunk networks holding different fluids.
 */
export class PipeBehavior extends AbstractBehavior {

    install(engine, placed) {
        engine.provide(Pipes, new Pipes(engine));
    }

    canSpawn(engine, placed, type, message) {
        return engine.resolve(Pipes).canJoin(message.x, message.y);
    }

    onSpawn(engine, placed, eid, type, message) {
        engine.resolve(Pipes).placePipe(message.x, message.y, placed.objectIdOf(eid));
    }

    onDespawn(engine, placed, eid) {
        engine.resolve(Pipes).removePipe(placed.objectIdOf(eid));
    }

    /**
     * Re-registers every placed pipe with the network engine after a load.
     * @param {GameEngine} engine
     * @param {PlacedObjects} placed
     * @returns {void}
     */
    onRebuild(engine, placed) {
        const pipes = engine.resolve(Pipes);
        pipes.resetPipes();
        const def = placed.def;
        const placedObject = def.store;
        const position = engine.Position;
        for (let row = 0; row < def.count; row += 1) {
            if (!(placed.behaviorFor(placedObject.typeId[row]) instanceof PipeBehavior)) {
                continue;
            }
            const eid = def.eids[row];
            pipes.registerPipe({
                x: position.x[eid],
                y: position.y[eid],
                id: placedObject.objectId[row],
            });
        }
    }
}
