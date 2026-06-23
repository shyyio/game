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
     * @param [priority] {string} Transfer priority (higher value = higher priority)
     */
    constructor(name, gameObject, inputPort, outputPort, priority="0") {
        super(name, null);
        this.gameObject = gameObject;
        this.inputPort = inputPort;
        this.outputPort = outputPort;
        this.priority = priority;
    }

    get sql() {
        return `
            INSERT INTO PortTransferIntent (source_id, destination_id, priority, destination_is_empty)
            SELECT
                ${this.gameObject}.${this.inputPort} source_id,
                ${this.gameObject}.${this.outputPort} destination_id,
                (${this.priority}) priority,
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
     * AbstractMessage/event classes this mod sends over the wire. Each must expose a
     * static wireFields map.
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
     * Client-side hook: handle an event delivered to this mod's client, updating
     * its own world state and draw layers. The simulation-side base is a no-op;
     * client mods override it. Defaults to a no-op.
     * @param {AbstractEvent} event
     * @param {Client} client
     */
    onClientEvent(event, client) {

    }

    /**
     * Server-side hook: return the individual events that recreate this mod's
     * objects in a freshly-loaded chunk (one per object, e.g. a BeltInsertEvent per
     * belt). The engine bundles every mod's events into one ChunkSyncEvent per
     * chunk. Defaults to none.
     * @param {string} chunk - a chunk key that just entered a viewport
     * @returns {AbstractEvent[]}
     */
    collectChunkSync(chunk) {
        return [];
    }

    /**
     * Returns mini menu entries for the tile at (tileX, tileY).
     * Each entry carries its own handler — the mod decides what happens when clicked.
     * @param {number} tileX
     * @param {number} tileY
     * @param {AbstractSession} session
     * @returns {MiniMenuEntry[]}
     */
    miniMenuContextEntries(tileX, tileY, session) {
        return [];
    }

    /**
     * Returns the tools this mod makes available given the current player settings.
     * Called on init and again whenever any PlayerSetting changes.
     * @param {AbstractSession} session
     * @param {PlayerSettings} playerSettings
     * @returns {AbstractTool[]}
     */
    tools(session, playerSettings) {
        return [];
    }
}

