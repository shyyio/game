import {AbstractModDeclaration, LogicKeyEntry} from "@spup/sdk";
import {FLUID_TYPE_WATER, FLUID_TYPE_OIL, LOGIC_KEY_AMOUNT} from "./common/constants.js";
import {PipeDefinition, TankDefinition} from "./common/objectTypes.js";
import {
    PipeNetworkRecalculateEvent,
    PipeNetworkBatchEvent,
    PipeFluidSetEvent,
    PipeFluidBatchEvent,
    TankFluidSetEvent,
} from "./common/events.js";

export class FluidsDeclaration extends AbstractModDeclaration {

    /**
     * @returns {string}
     */
    get name() {
        return "Fluids";
    }

    get objectTypes() {
        return [
            PipeDefinition,
            TankDefinition,
        ];
    }

    get logicKeys() {
        return {[LOGIC_KEY_AMOUNT]: new LogicKeyEntry("Amount")};
    }

    get wireClasses() {
        return [
            PipeNetworkRecalculateEvent,
            PipeNetworkBatchEvent,
            PipeFluidSetEvent,
            PipeFluidBatchEvent,
            TankFluidSetEvent,
        ];
    }

    get fluidTypes() {
        return [FLUID_TYPE_WATER, FLUID_TYPE_OIL];
    }
}
