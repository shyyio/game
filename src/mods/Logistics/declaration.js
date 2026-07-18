import {AbstractModDeclaration} from "@/sdk/common.js";
import {CreateBeltMessage} from "./messages.js";
import {BeltDefinition, SplitterDefinition} from "./objectTypes.js";
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
} from "./events.js";

export class LogisticsDeclaration extends AbstractModDeclaration {

    get objectTypes() {
        return [BeltDefinition, SplitterDefinition];
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
        ];
    }

    get itemTextures() {
        return {3: "items/1"};
    }
}
