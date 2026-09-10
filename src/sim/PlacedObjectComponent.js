import {AbstractComponent, FieldDefinition, NO_EID} from "@/sim/AbstractComponent.js";
import {PLAYER_REF_NONE} from "@/common/constants.js";

/**
 * A placed object: its type, its public handle, and who placed it. Where it sits lives on the
 * shared Position component.
 */
export class PlacedObjectComponent extends AbstractComponent {

    constructor() {
        super("PlacedObject", [
            new FieldDefinition("objectTypeId", "type"),
            new FieldDefinition("objectRef", "i32", NO_EID),
            // A friend building in your chunk is recorded as themselves.
            // Economics read getClaimOwnerByEid instead, which follows the ground.
            new FieldDefinition("placedBy", "i32", PLAYER_REF_NONE),
        ], {sparse: true});
    }
}
