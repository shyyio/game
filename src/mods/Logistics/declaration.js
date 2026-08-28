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
    PoleDefinition,
    ControlTerminalDefinition,
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
    ControlLinkSetEvent,
    ControlLinkClearEvent,
    ControlWireSetEvent,
    ControlWireClearEvent,
    ControlSnapshotEvent,
} from "./common/events.js";
import {
    SetGateOpenMessage,
    WireLinkMessage,
    WireUnlinkMessage,
    ControlSnapshotRequestMessage,
} from "./common/messages.js";

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
            PoleDefinition,
            ControlTerminalDefinition,
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
            ControlLinkSetEvent,
            ControlLinkClearEvent,
            ControlWireSetEvent,
            ControlWireClearEvent,
            WireLinkMessage,
            WireUnlinkMessage,
            ControlSnapshotEvent,
            ControlSnapshotRequestMessage,
        ];
    }

    get items() {
        return {3: new ItemDefinition("Cargo", "items/1")};
    }
}
