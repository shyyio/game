import {AbstractBehavior} from "@spup/sdk";
import {CONTROL_TIER_BASE} from "../common/constants.js";
import {ControlNetworks} from "./ControlNetworks.js";

/**
 * A control terminal: the config surface of its network. One per network, enforced at wire time
 * (LogisticsSimMod); the rules it will hold come with the rules engine.
 */
export class ControlTerminalBehavior extends AbstractBehavior {

    install(engine, placed) {
        engine.defineComponent("ControlTerminal", [
            {name: "tier", fill: CONTROL_TIER_BASE},
        ], {sparse: true});
    }

    onSpawn(engine, placed, eid, type, message) {
        engine.attachComponent(engine.component("ControlTerminal"), eid);
    }

    onDespawn(engine, placed, eid) {
        // Frees the network's terminal slot before the entity (and its link row) is destroyed.
        engine.resolve(ControlNetworks).unlink(eid);
    }
}
