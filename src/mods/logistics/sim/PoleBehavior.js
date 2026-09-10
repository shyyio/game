import {AbstractBehavior, chunkKeyAt} from "@spup/sdk";
import {LogicWireSetEvent} from "../common/events.js";
import {LogicNetworks} from "./LogicNetworks.js";

/**
 * A logic-network pole: a plain wire hub. Owns the shared LogicNetworks service; every
 * connection is an explicit wire between wireable endpoints (see LogicNetworks).
 */
export class PoleBehavior extends AbstractBehavior {

    install(engine) {
        const networks = new LogicNetworks(engine);
        engine.provide(LogicNetworks, networks);
        engine.registerDespawnListener((eid, objectRef) => networks.removeObject(objectRef));
        engine.registerChunkSync(chunk => PoleBehavior._chunkSync(engine, chunk));
    }

    onSpawn(engine, eid, type, message) {
        engine.resolve(LogicNetworks).addPole(eid);
    }

    onRebuild(engine) {
        const networks = engine.resolve(LogicNetworks);
        networks.reset();
        const placed = engine.placed;
        const def = placed.objects;
        const placedObject = def.store;
        for (let row = 0; row < def.count; row += 1) {
            if (placed.behaviorFor(placedObject.objectTypeId[row]) instanceof PoleBehavior) {
                networks.addPole(def.eids[row]);
            }
        }
    }

    /**
     * Chunk sync: every wire with an endpoint in the chunk, once.
     * @private
     * @param {GameEngine} engine
     * @param {number} chunkKey
     * @returns {LogicWireSetEvent[]}
     */
    static _chunkSync(engine, chunkKey) {
        const placed = engine.placed;
        const position = engine.Position;
        const events = [];
        for (const wire of engine.resolve(LogicNetworks).wires) {
            for (const objectRef of [wire.a, wire.b]) {
                const eid = placed.eidByObjectRef(objectRef);
                if (eid === undefined || chunkKeyAt(position.x[eid], position.y[eid]) !== chunkKey) {
                    continue;
                }
                events.push(new LogicWireSetEvent(position.x[eid], position.y[eid], wire.a, wire.b));
                break;
            }
        }
        return events;
    }
}
