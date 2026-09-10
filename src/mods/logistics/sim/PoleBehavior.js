import {AbstractBehavior} from "@spup/sdk";
import {LogicNetworks} from "./LogicNetworks.js";

/**
 * A logic-network pole: a plain wire hub. Owns the shared LogicNetworks service; every
 * connection is an explicit wire between wireable endpoints (see LogicNetworks).
 */
export class PoleBehavior extends AbstractBehavior {

    install(engine) {
        engine.registerSystem(engine.provide(LogicNetworks, new LogicNetworks(engine)));
    }

    onSpawn(engine, eid, type, message) {
        engine.resolve(LogicNetworks).addPole(eid);
    }

    onRebuild(engine) {
        const networks = engine.resolve(LogicNetworks);
        networks.reset();
        const placed = engine.placed;
        const objects = placed.objects;
        const placedObject = objects.store;
        for (let row = 0; row < objects.count; row += 1) {
            if (placed.getBehaviorByTypeId(placedObject.objectTypeId[row]) instanceof PoleBehavior) {
                networks.addPole(objects.eids[row]);
            }
        }
    }
}
