import {AbstractComponent, NO_EID} from "@spup/sdk";

/**
 * A pipe's membership as saved: its network and the pipe's object ref.
 */
export class PipeNetworkMemberComponent extends AbstractComponent {

    constructor() {
        super("PipeNetworkMember", [
            {name: "network", kind: "eid", defaultValue: NO_EID},
            {name: "objectRef", defaultValue: NO_EID},
        ], {snapshotOnly: true});
    }
}
