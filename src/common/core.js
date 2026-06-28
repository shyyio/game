import {rotate, chunkKey} from "@/common/util.js";
import {Direction, OCCUPANCY_LAYER_SURFACE} from "@/common/constants.js";

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
        // The occupancy layer this object sits on. Objects on different layers coexist on a
        // tile; objects on the same layer collide. Multi-layer objects override occupancyLookups.
        this.occupancyLayer = OCCUPANCY_LAYER_SURFACE;
    }

    /**
     * The tile offsets this object covers when placed facing `direction`, derived from its
     * size (a single tile for a 0-size object). Add the base tile to get world tiles.
     * @param {Direction} direction
     * @returns {{x: number, y: number}[]}
     */
    footprint(direction) {
        const corner = rotate(this.size, direction);
        const stepX = Math.sign(corner.x);
        const stepY = Math.sign(corner.y);
        const cells = [];
        for (let i = 0; i <= Math.abs(corner.x); i += 1) {
            for (let j = 0; j <= Math.abs(corner.y); j += 1) {
                cells.push({x: i * stepX, y: j * stepY});
            }
        }
        return cells;
    }

    /**
     * Whether this object's footprint at (tileX, tileY) facing `direction` crosses a chunk
     * boundary. Placement rejects it, so every object lives in exactly one chunk (chunk-keyed
     * sync and occupancy assume a single owning chunk).
     * @param {number} tileX
     * @param {number} tileY
     * @param {Direction} direction
     * @returns {boolean}
     */
    footprintSpansChunks(tileX, tileY, direction) {
        const base = chunkKey(tileX, tileY);
        return this.footprint(direction).some(cell => chunkKey(tileX + cell.x, tileY + cell.y) !== base);
    }

    /**
     * SQL SELECT-1 fragments matching when this object covers tile (@x, @y) on layer @layer,
     * UNIONed by the engine into IsOccupied for placement collision. The default checks the
     * size-derived footprint in every orientation against this object's single layer; objects
     * whose layer depends on row state override this.
     * @param {string} table - this object's table name
     * @returns {string[]}
     */
    occupancyLookups(table) {
        const conditions = [];
        [Direction.UP, Direction.RIGHT, Direction.DOWN, Direction.LEFT].forEach(direction => {
            this.footprint(direction).forEach(cell => {
                conditions.push(`(${table}.direction = ${direction} AND ${table}.x = @x - ${cell.x} AND ${table}.y = @y - ${cell.y})`);
            });
        });
        return [`SELECT 1 FROM ${table} WHERE @layer = ${this.occupancyLayer} AND (${conditions.join(" OR ")})`];
    }

    /**
     * SQL SELECT fragments (one per port) resolving the Port id at tile (@x, @y) for this
     * object's input/output ports facing `direction`, UNIONed by the engine for a
     * position-based port lookup. The default reads each port from its own column; objects
     * whose ports live elsewhere override this.
     * @param {string} table - this object's table name
     * @param {("inputPorts"|"outputPorts")} portKind
     * @param {Direction} direction
     * @returns {string[]}
     */
    portLookups(table, portKind, direction) {
        return this[portKind].map(port => {
            const offset = rotate(port, direction);
            return `
                SELECT ${table}.${port.name} AS id
                FROM ${table}
                    INNER JOIN Port ON Port.id = ${table}.${port.name}
                WHERE ${table}.direction = ${direction}
                  AND ${table}.x = @x - ${offset.x}
                  AND ${table}.y = @y - ${offset.y}`;
        });
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
     * Client-side init, called once by Client.init, so a mod can grab shared client surfaces
     * (e.g. the object index) for use in hooks that aren't passed `client`.
     * @param {Client} client
     * @returns {void}
     */
    clientInit(client) {

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

