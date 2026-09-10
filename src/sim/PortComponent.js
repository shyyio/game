import {AbstractComponent, FieldDefinition, EMPTY} from "@/sim/AbstractComponent.js";

/**
 * A port: the item it holds, EMPTY when unoccupied. An edge port also carries Position for the
 * edge it sits on; a port with no Position is not an edge port.
 */
export class PortComponent extends AbstractComponent {

    constructor() {
        super("Port", [
            new FieldDefinition("item", "item", EMPTY),
        ]);
    }
}
