import {AbstractModDeclaration} from "@/sdk/common.js";
import {CreateBeltMessage} from "./messages.js";
import {BeltDefinition, SplitterDefinition, RoadDefinition, HousingDefinition} from "./objectTypes.js";
import {
    BeltPathRecalculateEvent,
    BeltInsertEvent,
    BeltDeleteEvent,
    BeltSyncEvent,
    BeltItemUpsertEvent,
    BeltItemSyncEvent,
    BeltItemDeleteEvent,
    BeltItemResetEvent,
    BeltItemBatchEvent,
    BeltSyncBatchEvent,
    BeltPathBatchEvent,
} from "./events.js";

export class LogisticsDeclaration extends AbstractModDeclaration {

    get objectTypes() {
        return [BeltDefinition, SplitterDefinition, RoadDefinition, HousingDefinition];
    }

    get wireClasses() {
        return [
            CreateBeltMessage,
            BeltInsertEvent,
            BeltDeleteEvent,
            BeltPathRecalculateEvent,
            BeltSyncEvent,
            BeltItemUpsertEvent,
            BeltItemSyncEvent,
            BeltItemDeleteEvent,
            BeltItemResetEvent,
            BeltItemBatchEvent,
            BeltSyncBatchEvent,
            BeltPathBatchEvent,
        ];
    }

    get itemTextures() {
        return {3: "items/1"};
    }
}
