import {AbstractComponent, FieldDefinition, NO_EID} from "@spup/sdk";

/**
 * A pipe's membership as saved: its network and the pipe's object ref.
 */
export class PipeNetworkMemberComponent extends AbstractComponent {

    constructor() {
        super("PipeNetworkMember", [
            new FieldDefinition("network", "eid", NO_EID),
            new FieldDefinition("objectRef", "i32", NO_EID),
        ], {snapshotOnly: true});
    }
}
