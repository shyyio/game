import {AbstractBehavior} from "@spup/sdk";
import {PipeNetworkIndex} from "./PipeNetworkIndex.js";

/**
 * A pipe cell: spawn/despawn feed the shared Pipes network engine; placement is rejected when it
 * would merge same-chunk networks holding different fluids.
 */
export class PipeBehavior extends AbstractBehavior {

    install(engine) {
        engine.provide(PipeNetworkIndex, new PipeNetworkIndex(engine));
    }

    canSpawn(engine, type, message) {
        return engine.resolve(PipeNetworkIndex).canJoin(message.x, message.y);
    }

    onSpawn(engine, eid, type, message) {
        engine.resolve(PipeNetworkIndex).placePipe(message.x, message.y, engine.placed.getObjectRefByEid(eid));
    }

    onDespawn(engine, eid) {
        engine.resolve(PipeNetworkIndex).removePipe(engine.placed.getObjectRefByEid(eid));
    }

    /**
     * Re-registers every placed pipe with the network engine after a load.
     * @param {GameEngine} engine
     * @returns {void}
     */
    onRebuild(engine) {
        const pipes = engine.resolve(PipeNetworkIndex);
        pipes.resetPipes();
        const placed = engine.placed;
        const objects = placed.objects;
        const placedObject = objects.store;
        const position = engine.Position;
        for (let row = 0; row < objects.count; row += 1) {
            if (!(placed.getBehaviorByTypeId(placedObject.objectTypeId[row]) instanceof PipeBehavior)) {
                continue;
            }
            const eid = objects.eids[row];
            pipes.registerPipe({
                x: position.x[eid],
                y: position.y[eid],
                id: placedObject.objectRef[row],
            });
        }
    }
}
