export class TickOp {

    /**
     * @param [statementName] {string}
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
     */
    constructor(name, gameObject, inputPort, outputPort) {
        super(name, null);
        this.gameObject = gameObject;
        this.inputPort = inputPort;
        this.outputPort = outputPort;
    }

    get sql() {
        return `
            INSERT INTO PortTransferIntent (source_id, destination_id, destination_is_empty)
            SELECT
                ${this.gameObject}.${this.inputPort} source_id,
                ${this.gameObject}.${this.outputPort} destination_id,
                (dst.item IS NULL) destination_is_empty
            FROM ${this.gameObject}
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

export class MiniMenuEntry {

    /**
     * @param {string} label
     * @param {number} rank
     * @param {function(): void} callback
     */
    constructor(label, rank, callback) {
        this.label = label;
        this.rank = rank;
        this.callback = callback;
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
        this.tickPhases = tickPhases || {};
    }
}

export class AbstractMod {

    constructor() {
        /**
         * @type {Game}
         */
        this.game = null;
    }

    /**
     * @returns {TextureDefinition[]}
     */
    get textureDefinitions() {

    }

    /**
     * @returns {Object.<string, string>}
     */
    get statements() {
        return {};
    }

    /**
     * @returns string
     */
    get schema() {
        return "";
    }

    /**
     * @returns string
     */
    get tempSchema() {
        return "";
    }

    /**
     * @returns {Object.<string, ObjectDefinition>}
     */
    get definitions() {
        return {};
    }

    /**
     * Message/event classes this mod sends over the wire (each with a static wireFields map).
     * @returns {Function[]}
     */
    get wireClasses() {
        return [];
    }

    /**
     * @returns {AbstractDrawLayer[]}
     */
    get drawLayers() {

    }

    /**
     * @param {AbstractMessage} message
     */
    onMessage(message) {

    }

    /**
     * Client-side hook to handle an event, updating the mod's own state and draw layers.
     * @param {AbstractEvent} event
     * @param {Client} client
     */
    onClientEvent(event, client) {

    }

    /**
     * Client-side inspect hook (null coords = cleared); returns the tiles to highlight
     * and may update the mod's own draw layers.
     * @param {number|null} tileX
     * @param {number|null} tileY
     * @returns {{x: number, y: number, alt?: boolean}[]}
     */
    onInspect(tileX, tileY) {
        return [];
    }

    /**
     * Server-side hook returning the per-object events that recreate this mod's objects in a chunk.
     * @param {string} chunk - a chunk key that just entered a viewport
     * @returns {AbstractEvent[]}
     */
    collectChunkSync(chunk) {
        return [];
    }

    /**
     * Returns mini-menu entries (each with its own handler) for the tile at (tileX, tileY).
     * @param {number} tileX
     * @param {number} tileY
     * @param {AbstractSession} session
     * @returns {MiniMenuEntry[]}
     */
    miniMenuContextEntries(tileX, tileY, session) {
        return [];
    }

    /**
     * Returns the tools this mod makes available, bound to the shared client surfaces.
     * @param {Client} client
     * @returns {AbstractTool[]}
     */
    tools(client) {
        return [];
    }
}

