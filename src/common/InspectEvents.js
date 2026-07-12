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
     * @param {BigInt} objectId
     * @param {number[]} inputPorts - per-port resting item (0 = empty)
     * @param {number[]} inputMemory - per-port gathered/consumed item (0 = none)
     * @param {number|null} processingRemaining - ticks left (null = idle)
     * @param {number} processingTotal
     * @param {number|null} outputItem
     * @param {number|null} recipeOutput - inferred product (null = nothing gathered)
     */
    constructor(objectId, inputPorts, inputMemory, processingRemaining, processingTotal, outputItem, recipeOutput) {
        super();
        this.objectId = objectId;
        this.inputPorts = inputPorts;
        this.inputMemory = inputMemory;
        this.processingRemaining = processingRemaining;
        this.processingTotal = processingTotal;
        this.outputItem = outputItem;
        this.recipeOutput = recipeOutput;
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
