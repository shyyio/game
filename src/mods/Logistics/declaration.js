import {AbstractModDeclaration, ItemDefinition, LogicKeyEntry, LogicKeyState} from "@spup/sdk";
import {LOGIC_KEY_OPEN} from "./common/constants.js";
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
    LogicTerminalDefinition,
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
    LogicWireSetEvent,
    LogicWireClearEvent,
    LogicSnapshotEvent,
} from "./common/events.js";
import {
    SetGateOpenMessage,
    WireLinkMessage,
    WireUnlinkMessage,
    LogicSnapshotRequestMessage,
    ConfigureLogicRulesMessage,
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
            LogicTerminalDefinition,
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
            LogicWireSetEvent,
            LogicWireClearEvent,
            WireLinkMessage,
            WireUnlinkMessage,
            LogicSnapshotEvent,
            LogicSnapshotRequestMessage,
            ConfigureLogicRulesMessage,
        ];
    }

    get items() {
        return {3: new ItemDefinition("Cargo", "items/1")};
    }

    get logicKeys() {
        return {[LOGIC_KEY_OPEN]: new LogicKeyEntry("Open", [
            new LogicKeyState(1, "Open", "is open"),
            new LogicKeyState(0, "Close", "is closed"),
        ], "Gate state")};
    }
}
