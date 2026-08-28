import {AbstractBehavior, chunkId} from "@spup/sdk";
import {POLE_NONE} from "../common/constants.js";
import {ControlLinkSetEvent, ControlWireSetEvent} from "../common/events.js";
import {ControlNetworks} from "./ControlNetworks.js";

/**
 * A control-network pole: auto-links to poles in range, anchors explicit device wires. Owns the
 * shared ControlNetworks service and the ControlLink component.
 */
export class PoleBehavior extends AbstractBehavior {

    install(engine, placed) {
        // On a wireable device's eid; the wired pole's objectId, POLE_NONE when unwired.
        engine.defineComponent("ControlLink", [
            {name: "pole", fill: POLE_NONE},
        ], {sparse: true});
        engine.provide(ControlNetworks, new ControlNetworks(engine, placed));
        engine.registerChunkSync(chunk => PoleBehavior._chunkSync(engine, placed, chunk));
    }

    onSpawn(engine, placed, eid, type, message) {
        engine.resolve(ControlNetworks).addPole(eid);
    }

    onDespawn(engine, placed, eid) {
        engine.resolve(ControlNetworks).removePole(eid);
    }

    onRebuild(engine, placed) {
        const networks = engine.resolve(ControlNetworks);
        networks.reset();
        const def = placed.def;
        const placedObject = def.store;
        for (let row = 0; row < def.count; row += 1) {
            if (placed.behaviorFor(placedObject.typeId[row]) instanceof PoleBehavior) {
                networks.addPole(def.eids[row]);
            }
        }
    }

    /**
     * Chunk sync: the chunk's device wires, plus every pole-pole wire with an endpoint in it.
     * @private
     * @param {GameEngine} engine
     * @param {PlacedObjects} placed
     * @param {number} chunk
     * @returns {(ControlLinkSetEvent|ControlWireSetEvent)[]}
     */
    static _chunkSync(engine, placed, chunk) {
        const def = engine.component("ControlLink");
        const link = def.store;
        const position = engine.Position;
        const events = [];
        for (let row = 0; row < def.count; row += 1) {
            if (link.pole[row] === POLE_NONE) {
                continue;
            }
            const eid = def.eids[row];
            if (chunkId(position.x[eid], position.y[eid]) !== chunk) {
                continue;
            }
            events.push(new ControlLinkSetEvent(
                position.x[eid],
                position.y[eid],
                placed.objectIdOf(eid),
                link.pole[row],
            ));
        }
        for (const wire of engine.resolve(ControlNetworks).wires) {
            for (const objectId of [wire.a, wire.b]) {
                const eid = placed.eidByObjectId(objectId);
                if (eid === undefined || chunkId(position.x[eid], position.y[eid]) !== chunk) {
                    continue;
                }
                events.push(new ControlWireSetEvent(position.x[eid], position.y[eid], wire.a, wire.b));
                break;
            }
        }
        return events;
    }
}
