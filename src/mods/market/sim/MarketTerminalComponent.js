import {AbstractComponent, EMPTY, NO_EID, PLAYER_REF_NONE} from "@spup/sdk";

/**
 * A trading terminal: its mode, listing, ports and the per-tick market scratch.
 */
export class MarketTerminalComponent extends AbstractComponent {

    constructor() {
        super("MarketTerminal", [
            {name: "mode"},
            {name: "itemTypeId", kind: "item", defaultValue: EMPTY},
            {name: "price"},
            // Buy only: cached owner balance, refreshed per tick by MarketSimMod.onTick. Not authoritative.
            {name: "balance"},
            // Buy only: cached chunk owner, lets _submitIntents pool balance across a player's buy terminals.
            {name: "owner", defaultValue: PLAYER_REF_NONE},
            // Sell only: whether this terminal's chunk is owned, refreshed per tick by MarketSimMod.onTick.
            {name: "sellEnabled"},
            // Sell-only scratch: price/counterparty this row is selling to this tick.
            {name: "pendingPrice", defaultValue: EMPTY},
            {name: "pendingBuyer", kind: "eid", defaultValue: NO_EID},
            {name: "pendingIsNpc", defaultValue: 0},
            {name: "in", kind: "eid", defaultValue: NO_EID},
            {name: "out", kind: "eid", defaultValue: NO_EID},
            {name: "lastOutput", kind: "item", defaultValue: EMPTY},
        ], {sparse: true});
    }
}
