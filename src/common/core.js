/**
 * @typedef StatementName {string}
 */

// ---- Core event type ----
export const EVENT_TYPE_CORE = 0;

// ---- Core event subtypes ----
export const EVENT_SUBTYPE_CHUNK_SUBSCRIBE = 1;
export const EVENT_SUBTYPE_CHUNK_UNSUBSCRIBE = 2;


export class TickOp {

    /**
     * @param [statementName] {StatementName}
     * @param [sql] {string|null}
     */
    constructor(statementName, sql) {
        this.statementName = statementName;
        this._sql = sql;
    }

    /**
     * @return string
     */
    get sql() {
       return this._sql;
    }
}

export class PortDefinition {
    /**
     * @param name {string}
     * @param [vec] {Vec|null}
     */
    constructor(name, vec=null) {
        this.name = name;
        if (vec !== null) {
            this.x = vec.x;
            this.y = vec.y;
            this.direction = vec.direction;
        } else {
            this.x = null;
            this.y = null;
            this.direction = null;
        }
    }
}

export class PortTransferOp extends TickOp {

    /**
     * @param name {string}
     * @param gameObject {GameObject}
     * @param inputPort {string}
     * @param outputPort {string}
     * @param [priority] {string} Transfer priority (higher value = higher priority)
     * @param [onTransfer] {string|null}
     */
    constructor(name, gameObject, inputPort, outputPort, priority="0", onTransfer) {
        super(name, null);
        this.gameObject = gameObject
        this.inputPort = inputPort;
        this.outputPort = outputPort;
        this.priority = priority;
        // TODO
        this.onTransfer = onTransfer;
    }

    get sql() {
        return `
            INSERT INTO PortTransferIntent (source, destination, priority, destination_is_empty)
            SELECT 
                ${this.gameObject}.${this.inputPort} source,
                ${this.gameObject}.${this.outputPort} destination,
                (${this.priority}) priority,
                (dst.item IS NULL) destination_is_empty
            FROM
                ${this.gameObject}
            INNER JOIN Port dst ON dst.id = ${this.gameObject}.${this.outputPort}
            INNER JOIN Port src ON src.id = ${this.gameObject}.${this.inputPort}
            WHERE src.item IS NOT NULL;`;
    }
}

/**
 * @enum
 */
export const TickPhase = {

    /**
     * Submit port transfer intents
     */
    SUBMIT_INTENTS: 1,

    /**
     * (internal) Resolve initial transfer intents and save the result in a temp table
     */
    RESOLVE_TRANSFERS: 2,

    /**
     * Executed after transfer intents
     */
    POST_RESOLVE: 3,

    /**
     * (internal) Flush transfers to Port
     */
    COMMIT_TRANSFERS: 4,
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

export class MiniMenuEntry {

    /**
     * @param {string} label
     * @param {number} rank
     * @param {function(): void} handler
     */
    constructor(label, rank, handler) {
        this.label = label;
        this.rank = rank;
        this.handler = handler;
    }
}

export class ObjectDefinition {

    /**
     * @param inputPorts {PortDefinition[]}
     * @param outputPorts {PortDefinition[]}
     * @param internalPorts {PortDefinition[]}
     * @param size {Vec}
     * @param tickPhases {Object.<TickPhase, TickOp[]>}
     */
    constructor(inputPorts, outputPorts, internalPorts, size, tickPhases) {
        this.inputPorts = inputPorts;
        this.outputPorts = outputPorts;
        this.internalPorts = internalPorts;
        this.size = size;
        this.tickPhases = tickPhases || [];
    }
}

export class Mod {

    constructor() {
        /**
         * @type {Game}
         */
        this.game = null;
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

    /**
     * Message/event classes this mod sends over the wire. Each must expose a
     * static wireFields map.
     * @returns {Function[]}
     */
    get wireClasses() {
        return [];
    }

    /**
     * @abstract
     * @returns string
     */
    get triggers() {

    }

    /**
     * @abstract
     * @param {Message} message
     */
    onMessage(message) {

    }

    /**
     * @abstract
     * Returns mini menu entries for the tile at (x, y).
     * Each entry carries its own handler — the mod decides what happens when clicked.
     * @param {number} x - tile x
     * @param {number} y - tile y
     * @param {Session} session
     * @returns {MiniMenuEntry[]}
     */
    miniMenuContextEntries(x, y, session) {}

    /**
     * @abstract
     * Returns the tools this mod makes available given the current player settings.
     * Called on init and again whenever any PlayerSetting changes.
     * @param {Session} session
     * @param {PlayerSettings} playerSettings
     * @returns {Tool[]}
     */
    getTools(session, playerSettings) {}
}

