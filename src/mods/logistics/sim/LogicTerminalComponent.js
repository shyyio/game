import {AbstractComponent} from "@spup/sdk";
import {LOGIC_TIER_BASE} from "../common/constants.js";

/**
 * A logic terminal: its tier.
 */
export class LogicTerminalComponent extends AbstractComponent {

    constructor() {
        super("LogicTerminal", [
            {name: "tier", defaultValue: LOGIC_TIER_BASE},
        ], {sparse: true});
    }
}
