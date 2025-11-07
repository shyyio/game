import {before} from "underscore";

export class PortDefinition {
    /**
     * @param name {string}
     * @param vec {Vec}
     */
    constructor(name, vec) {
        this.name = name;
        this.x = vec.x;
        this.y = vec.y;
        this.direction = vec.direction;
    }
}

export class TransferDefinition {
    /**
     * @param port {string}
     * @param slot {string}
     * @param [join] {string|null}
     * @param [where] {string|null}
     * @param [afterTransfer] {string|null}
     * @param [visibilityTimeout] {number}
     */
    constructor(port, slot, join, where, afterTransfer, visibilityTimeout = 0) {
        this.port = port;
        this.slot = slot;
        this.join = join || "";
        this.where = where ? `AND ${where}` : "";
        this.afterTransfer = afterTransfer || null;
        this.visibilityTimeout = visibilityTimeout;
    }
}

export class PortTransferDefinition {

    /**
     * @param inputPort {string}
     * @param outputPort {string}
     * @param [join] {string|null}
     * @param where {string}
     * @param [afterTransfer] {string|null}
     */
    constructor(inputPort, outputPort, join, where, afterTransfer) {
        this.inputPort = inputPort;
        this.outputPort = outputPort;
        this.join = join;
        this.where = where || "1=1";
        this.afterTransfer = afterTransfer;
    }
}

/**
 * @enum
 */
export const TickPhase = {
    INIT: 0,
    INPUT: 1,
    OUTPUT: 2
}

/**
 * @enum
 */
export const OpCode = {
    OUTPUT_TRANSFER: 0,
    INPUT_TRANSFER: 1,
    PORT_TRANSFER: 2,
    STMT: 3,
}

export class TickOp {
    /**
     * @param op {OpCode}
     * @param key {number|string}
     */
    constructor(op, key) {
        this.op = op;
        this.key = key;
    }
}

export class ObjectDefinition {

    /**
     * @param inputPorts {PortDefinition[]}
     * @param outputPorts {PortDefinition[]}
     * @param inputTransfers {TransferDefinition[]}
     * @param outputTransfers {TransferDefinition[]}
     * @param portTransfers {PortTransferDefinition[]}
     * @param statements {Object.<string,string>}
     * @param size {Vec}
     * @param tickPhases {Object.<TickPhase, TickOp[]>}
     */
    constructor(inputPorts, outputPorts, inputTransfers, outputTransfers, portTransfers, statements, size, tickPhases) {
        this.inputPorts = inputPorts;
        this.outputPorts = outputPorts;
        this.inputTransfers = inputTransfers;
        this.outputTransfers = outputTransfers;
        this.portTransfers = portTransfers;
        this.size = size;
        this.statements = statements;
        this.tickPhases = tickPhases || [];
    }
}

export class Mod {

    constructor() {

    }

    /**
     * @abstract
     * @returns string
     */
    get schema() {

    }

    /**
     * @abstract
     * @returns string
     */
    get tempSchema() {

    }

    /**
     * @abstract
     * @returns {Object.<string, ObjectDefinition>}
     */
    get definitions() {

    }
}


