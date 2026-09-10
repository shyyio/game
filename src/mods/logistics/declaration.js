import {AbstractModDeclaration, LogicKeyEntry, LogicKeyStateEntry} from "@spup/sdk";
import {LOGIC_KEY_OPEN} from "./common/constants.js";
import {
    BeltType,
    BeltTunnelDownType,
    BeltTunnelUpType,
    BeltUndergroundType,
    SplitterType,
    RoadType,
    HousingType,
    GateType,
    PoleType,
    LogicTerminalType,
} from "./common/objectTypes.js";
import {
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
        // The mouth/underground kinds append after the originals, keeping prior objectTypeIds stable.
        return [
            BeltType,
            SplitterType,
            RoadType,
            HousingType,
            BeltTunnelDownType,
            BeltTunnelUpType,
            BeltUndergroundType,
            GateType,
            PoleType,
            LogicTerminalType,
        ];
    }

    get wireClasses() {
        return [
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

    get logicKeys() {
        return {[LOGIC_KEY_OPEN]: new LogicKeyEntry("Open", [
            new LogicKeyStateEntry(1, "Open", "is open"),
            new LogicKeyStateEntry(0, "Close", "is closed"),
        ], "Gate state")};
    }
}
