import {AbstractComponent, FieldDefinition} from "@spup/sdk";
import {LOGIC_TIER_BASE} from "../common/constants.js";

/**
 * A logic terminal: its tier.
 */
export class LogicTerminalComponent extends AbstractComponent {

    constructor() {
        super("LogicTerminal", [
            new FieldDefinition("tier", "i32", LOGIC_TIER_BASE),
        ], {sparse: true});
    }
}
