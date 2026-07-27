import {AbstractModDeclaration} from "@/sdk/common.js";
import {
    BeltDefinition,
    BeltRampDownDefinition,
    BeltRampUpDefinition,
    BeltUndergroundDefinition,
    SplitterDefinition,
    RoadDefinition,
    HousingDefinition,
} from "./common/objectTypes.js";
import {
    BeltPathRecalculateEvent,
    BeltItemUpsertEvent,
    BeltItemSyncEvent,
    BeltItemDeleteEvent,
    BeltItemResetEvent,
    BeltItemBatchEvent,
    BeltPathBatchEvent,
} from "./common/events.js";

export class LogisticsDeclaration extends AbstractModDeclaration {

    /**
     * @returns {string}
     */
    get name() {
        return "Logistics";
    }

    get objectTypes() {
        // The ramp/underground kinds append after the originals, keeping prior typeIds stable.
        return [
            BeltDefinition,
            SplitterDefinition,
            RoadDefinition,
            HousingDefinition,
            BeltRampDownDefinition,
            BeltRampUpDefinition,
            BeltUndergroundDefinition,
        ];
    }

    get wireClasses() {
        return [
            BeltPathRecalculateEvent,
            BeltItemUpsertEvent,
            BeltItemSyncEvent,
            BeltItemDeleteEvent,
            BeltItemResetEvent,
            BeltItemBatchEvent,
            BeltPathBatchEvent,
        ];
    }

    get itemTextures() {
        return {3: "items/1"};
    }
}
