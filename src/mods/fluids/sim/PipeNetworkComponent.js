import {AbstractComponent, EMPTY} from "@spup/sdk";

/**
 * A pipe network as saved: the fluid it holds and how much. Written at save, read at load; the
 * live network is the JS record.
 */
export class PipeNetworkComponent extends AbstractComponent {

    constructor() {
        super("PipeNetwork", [
            {name: "fluidType", kind: "item", defaultValue: EMPTY},
            {name: "amount"},
        ], {snapshotOnly: true});
    }
}
