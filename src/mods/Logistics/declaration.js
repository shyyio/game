import {AbstractModDeclaration, ItemDefinition} from "@spup/sdk";
import {
    BeltDefinition,
    BeltTunnelDownDefinition,
    BeltTunnelUpDefinition,
    BeltUndergroundDefinition,
    SplitterDefinition,
    RoadDefinition,
    HousingDefinition,
    GateDefinition,
} from "./common/objectTypes.js";
import {
    BeltPathRecalculateEvent,
    BeltItemUpsertEvent,
    BeltItemSyncEvent,
    BeltItemDeleteEvent,
    BeltItemResetEvent,
    BeltItemBatchEvent,
    BeltPathBatchEvent,
    GateSetEvent,
    GateSetBatchEvent,
} from "./common/events.js";
import {SetGateOpenMessage} from "./common/messages.js";

export class LogisticsDeclaration extends AbstractModDeclaration {

    /**
     * @returns {string}
     */
    get name() {
        return "Logistics";
    }

    get objectTypes() {
        // The mouth/underground kinds append after the originals, keeping prior typeIds stable.
        return [
            BeltDefinition,
            SplitterDefinition,
            RoadDefinition,
            HousingDefinition,
            BeltTunnelDownDefinition,
            BeltTunnelUpDefinition,
            BeltUndergroundDefinition,
            GateDefinition,
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
            GateSetEvent,
            GateSetBatchEvent,
            SetGateOpenMessage,
        ];
    }

    get items() {
        return {3: new ItemDefinition("Cargo", "items/1")};
    }
}
