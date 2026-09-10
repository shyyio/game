import {AbstractComponent} from "@/sim/AbstractComponent.js";
import {PLAYER_REF_NONE} from "@/common/constants.js";
import {NO_EID} from "@/sim/sentinels.js";

/**
 * A placed object: its type, its public handle, and who placed it. Where it sits lives on the
 * shared Position component.
 */
export class PlacedObjectComponent extends AbstractComponent {

    constructor() {
        super("PlacedObject", [
            {name: "objectTypeId", kind: "type"},
            {name: "objectRef", defaultValue: NO_EID},
            // Record keeping only: a friend building in your chunk is recorded as themselves.
            // Economics read claimOwnerOf instead, which follows the ground.
            {name: "placedBy", defaultValue: PLAYER_REF_NONE},
        ], {sparse: true});
    }
}
