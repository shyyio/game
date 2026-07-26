import {AbstractChunkRoutedEvent, AbstractBatchEvent} from "@/sdk/common.js";

// `networkId` = the first member pipe's object id. Fluid events are network-granular, so deltas
// scale with networks, not pipe tiles.

/**
 * Restates one pipe network's membership after a placement edit.
 */
export class PipeNetworkRecalculateEvent extends AbstractChunkRoutedEvent {

    static wireFields = {
        networkId: "int64",
        parts: "int64[]",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} networkId
     * @param {number[]} parts - member pipe ids, ascending
     */
    constructor(x, y, networkId, parts) {
        super(x, y);
        this.networkId = networkId;
        this.parts = parts;
    }
}

/**
 * One chunk's pipe networks as packed columns: network `i` owns the next `partCounts[i]` entries
 * of `parts`.
 */
export class PipeNetworkBatchEvent extends AbstractBatchEvent {

    static wireFields = {
        networkIds: "int64[]",
        partCounts: "int32[]",
        parts: "int64[]",
    };

    /**
     * @param {number} x - the batched chunk's origin tile, routes the batch to that topic
     * @param {number} y
     */
    constructor(x, y) {
        super(x, y);
        this.networkIds = [];
        this.partCounts = [];
        this.parts = [];
    }

    /**
     * @param {number} networkId
     * @param {number[]} parts - member pipe ids, ascending
     * @returns {void}
     */
    add(networkId, parts) {
        this.networkIds.push(networkId);
        this.partCounts.push(parts.length);
        this.parts.push(...parts);
    }

    /**
     * @returns {PipeNetworkRecalculateEvent[]}
     */
    explode() {
        const events = [];
        let partAt = 0;
        for (let i = 0; i < this.networkIds.length; i += 1) {
            const parts = this.parts.slice(partAt, partAt + this.partCounts[i]);
            partAt += this.partCounts[i];
            events.push(new PipeNetworkRecalculateEvent(this.x, this.y, this.networkIds[i], parts));
        }
        return events;
    }
}

/**
 * A tank's held fluid type changed; EMPTY (-1) when drained. Amounts stay sim-side.
 */
export class TankFluidSetEvent extends AbstractChunkRoutedEvent {

    static wireFields = {
        objectId: "int64",
        fluidType: "sint32",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} objectId
     * @param {number} fluidType
     */
    constructor(x, y, objectId, fluidType) {
        super(x, y);
        this.objectId = objectId;
        this.fluidType = fluidType;
    }
}

/**
 * A pipe network's fluid state changed; fluidType is EMPTY (-1) when drained.
 */
export class PipeFluidSetEvent extends AbstractChunkRoutedEvent {

    static wireFields = {
        networkId: "int64",
        fluidType: "sint32",
        amount: "int32",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} networkId
     * @param {number} fluidType
     * @param {number} amount
     */
    constructor(x, y, networkId, fluidType, amount) {
        super(x, y);
        this.networkId = networkId;
        this.fluidType = fluidType;
        this.amount = amount;
    }
}

/**
 * One chunk's fluid-state deltas for a tick, as parallel columns.
 */
export class PipeFluidBatchEvent extends AbstractBatchEvent {

    static wireFields = {
        networkIds: "int64[]",
        fluidTypes: "sint32[]",
        amounts: "int32[]",
    };

    /**
     * @param {number} x - a network origin in the batched chunk, routes the batch to that topic
     * @param {number} y
     */
    constructor(x, y) {
        super(x, y);
        this.networkIds = [];
        this.fluidTypes = [];
        this.amounts = [];
    }

    /**
     * @param {number} networkId
     * @param {number} fluidType
     * @param {number} amount
     * @returns {void}
     */
    add(networkId, fluidType, amount) {
        this.networkIds.push(networkId);
        this.fluidTypes.push(fluidType);
        this.amounts.push(amount);
    }

    /**
     * @returns {PipeFluidSetEvent[]}
     */
    explode() {
        const events = [];
        for (let i = 0; i < this.networkIds.length; i += 1) {
            events.push(new PipeFluidSetEvent(this.x, this.y, this.networkIds[i], this.fluidTypes[i], this.amounts[i]));
        }
        return events;
    }
}
