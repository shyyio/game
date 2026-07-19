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
        laborCost: "int32?",
        laborWorkers: "int32?",
        laborSupply: "int32?",
        laborDemand: "int32?",
    };

    /**
     * @param {number} objectId
     * @param {number[]} inputPorts - per-port resting item (0 = empty)
     * @param {number[]} inputMemory - per-port gathered/consumed item (0 = none)
     * @param {number|null} processingRemaining - ticks left (null = idle)
     * @param {number} processingTotal
     * @param {number|null} outputItem
     * @param {number|null} recipeOutput - inferred product (null = nothing gathered)
     * @param {number|null} [laborCost] - labor the machine consumes (null = labor-free type)
     * @param {number|null} [laborWorkers] - workers granted, up to laborCost (null with laborCost)
     * @param {number|null} [laborSupply] - the road component's total supply (null when road-less)
     * @param {number|null} [laborDemand] - the road component's total demand (null when road-less)
     */
    constructor(
        objectId,
        inputPorts,
        inputMemory,
        processingRemaining,
        processingTotal,
        outputItem,
        recipeOutput,
        laborCost=null,
        laborWorkers=null,
        laborSupply=null,
        laborDemand=null,
    ) {
        super();
        this.objectId = objectId;
        this.inputPorts = inputPorts;
        this.inputMemory = inputMemory;
        this.processingRemaining = processingRemaining;
        this.processingTotal = processingTotal;
        this.outputItem = outputItem;
        this.recipeOutput = recipeOutput;
        this.laborCost = laborCost;
        this.laborWorkers = laborWorkers;
        this.laborSupply = laborSupply;
        this.laborDemand = laborDemand;
    }

    /**
     * @param {EventBus} bus
     * @returns {Set<number>|undefined}
     */
    subscribersIn(bus) {
        return bus.objectSubscribers(this.objectId);
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
     * @param {number} objectId
     */
    constructor(objectId) {
        super();
        this.objectId = objectId;
    }

    /**
     * @param {EventBus} bus
     * @returns {Set<number>|undefined}
     */
    subscribersIn(bus) {
        return bus.objectSubscribers(this.objectId);
    }
}
