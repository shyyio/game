import {AbstractComponent, FieldDefinition, EMPTY} from "@spup/sdk";

/**
 * A pipe network as saved: the fluid it holds and how much. Written at save, read at load; the
 * live network is the JS record.
 */
export class PipeNetworkComponent extends AbstractComponent {

    constructor() {
        super("PipeNetwork", [
            new FieldDefinition("fluidType", "item", EMPTY),
            new FieldDefinition("amount"),
        ], {isSnapshotOnly: true});
    }
}
