import {AbstractComponent, FieldDefinition, EMPTY, NO_EID, PLAYER_REF_NONE} from "@spup/sdk";

/**
 * A trading terminal: its mode, listing, ports and the per-tick market scratch.
 */
export class MarketTerminalComponent extends AbstractComponent {

    constructor() {
        super("MarketTerminal", [
            new FieldDefinition("mode"),
            new FieldDefinition("itemTypeId", "item", EMPTY),
            new FieldDefinition("price"),
            // Buy only: cached owner balance, refreshed per tick by MarketSimMod.onTick. Not authoritative.
            new FieldDefinition("balance"),
            // Buy only: cached chunk owner, lets _submitIntents pool balance across a player's buy terminals.
            new FieldDefinition("owner", "i32", PLAYER_REF_NONE),
            // Sell only: whether this terminal's chunk is owned, refreshed per tick by MarketSimMod.onTick.
            new FieldDefinition("sellEnabled"),
            // Sell-only scratch: price/counterparty this row is selling to this tick.
            new FieldDefinition("pendingPrice", "i32", EMPTY),
            new FieldDefinition("pendingBuyer", "eid", NO_EID),
            new FieldDefinition("pendingIsNpc", "i32", 0),
            new FieldDefinition("inputPort", "eid", NO_EID),
            new FieldDefinition("outputPort", "eid", NO_EID),
            new FieldDefinition("lastOutput", "item", EMPTY),
        ], {sparse: true});
    }
}
