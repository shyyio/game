import {AbstractBehavior} from "@spup/sdk";
import {LogicNetworkIndex} from "./LogicNetworkIndex.js";

/**
 * A logic-network pole: a plain wire hub. Owns the shared LogicNetworkIndex service; every
 * connection is an explicit wire between wireable endpoints (see LogicNetworkIndex).
 */
export class PoleBehavior extends AbstractBehavior {

    install(engine) {
        engine.registerSystem(engine.provide(LogicNetworkIndex, new LogicNetworkIndex(engine)));
    }

    onSpawn(engine, eid, type, message) {
        engine.resolve(LogicNetworkIndex).addPole(eid);
    }

    onRebuild(engine) {
        const networks = engine.resolve(LogicNetworkIndex);
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
