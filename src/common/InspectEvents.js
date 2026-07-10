import {AbstractEvent} from "@/common/AbstractEvent.js";

/**
 * A machine's inspect snapshot (on-open and per-tick). Per input port: `inputPorts` = item resting in
 * the port (0 = empty, shown full opacity), `inputMemory` = gathered/consumed item (0 = none, shown
 * half opacity). `outputItem` is the out-port item; `recipeOutput` the inferred product (null = nothing
 * gathered). Processing progress via processingRemaining/processingTotal (remaining null = idle).
 */
export class InspectHeartbeatEvent extends AbstractEvent {

    static wireFields = {
        objectId: "int64",
        inputPorts: "int32[]",
        inputMemory: "int32[]",
        processingRemaining: "int32?",
        processingTotal: "int32",
        outputItem: "int32?",
        recipeOutput: "int32?",
    };

    /**
     * @param {object} row - a BufferedInspectHeartbeatEvent snapshot row
     * @param {BigInt} row.object_id
     * @param {number|null} row.in_1_port - port item, 0 = empty, null = no such port
     * @param {number|null} row.in_1_mem - memory item, 0 = none, null = no such port
     * @param {number|null} row.in_2_port
     * @param {number|null} row.in_2_mem
     * @param {number|null} row.in_3_port
     * @param {number|null} row.in_3_mem
     * @param {number|null} row.processing_remaining
     * @param {number} row.processing_total
     * @param {number|null} row.output_item
     * @param {number|null} row.recipe_output
     */
    constructor(row) {
        super();
        this.objectId = row.object_id;
        this.inputPorts = [row.in_1_port, row.in_2_port, row.in_3_port].filter(item => item !== null);
        this.inputMemory = [row.in_1_mem, row.in_2_mem, row.in_3_mem].filter(item => item !== null);
        this.processingRemaining = row.processing_remaining;
        this.processingTotal = row.processing_total;
        this.outputItem = row.output_item;
        this.recipeOutput = row.recipe_output;
    }
}

/**
 * Tells a session an inspected machine is gone (deleted), so it closes that machine's menu.
 */
export class InspectClosedEvent extends AbstractEvent {

    static wireFields = {
        objectId: "int64",
    };

    /**
     * @param {BigInt} objectId
     */
    constructor(objectId) {
        super();
        this.objectId = objectId;
    }
}
