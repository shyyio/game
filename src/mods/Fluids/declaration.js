import {AbstractModDeclaration} from "@/sdk/common.js";
import {FLUID_TYPE_WATER, FLUID_TYPE_OIL} from "./common/constants.js";
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
