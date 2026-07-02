import {rotate} from "@/common/util.js";
import {Direction, OCCUPANCY_LAYER_SURFACE} from "@/common/constants.js";
import {ObjectGeometries} from "@/common/ObjectGeometry.js";

export class SqlStatement {

    /**
     * @param [statementName] {string}
     * @param [sql] {string}
     */
    constructor(statementName, sql) {
        this.statementName = statementName;
        this.sql = sql;
    }
}

export class PortDefinition {
    /**
     * @param name {string}
     * @param [vec] {Vec|null}
     * @param [render] {boolean} the engine captures this out-port's resting item into ViewedPortItem;
     *     opt out for virtual ports or out-ports captured manually
     */
    constructor(name, vec=null, render=true) {
        this.name = name;
        this.render = render;
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

    /**
     * The SQL column backing this port: its name with an `_id` suffix (it holds a Port id).
     * @returns {string}
     */
    get column() {
        return `${this.name}_id`;
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
     * Clear consumed source ports before the producers (belts) refill them in POST_RESOLVE.
     */
    CONSUME_INPUTS: 3,

    /**
     * Executed after transfer intents
     */
    POST_RESOLVE: 4,

    /**
     * Write resolved items into destination ports after the consumers ingested in POST_RESOLVE.
     */
    PRODUCE_OUTPUTS: 5,

    /**
     * (internal) Flush transfers to Port
     */
    COMMIT_TRANSFERS: 6,

    /**
     * (internal, engine-only) Diff/emit the out-port render events after mods have captured this
     * tick's watched port items in COMMIT_TRANSFERS. Mods register no ops here.
     */
    EMIT_RENDER: 7,
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

export class RecipeDefinition {

    /**
     * @param {number} verb
     * @param {number[]} inputs
     * @param {number} output
     */
    constructor(verb, inputs, output) {
        this.verb = verb;
        this.inputs = inputs;
        this.output = output;
    }
}

export class ObjectDefinition {

    /**
     * @param config {object}
     * @param config.table {string} the table instances of this type live in (also the definitions key)
     * @param config.inputPorts {PortDefinition[]}
     * @param config.outputPorts {PortDefinition[]}
     * @param config.internalPorts {PortDefinition[]}
     * @param config.geometry {string} a named geometry (key of ObjectGeometries, e.g. "1x1", "1x2")
     * @param [config.tickPhases] {Object.<TickPhase, SqlStatement[]>}
     * @param [config.renderConnections] {boolean} whether the shared ConnectionDrawLayer draws animated
     *     stubs at this object's connected ports (belts render their own bends instead)
     * @param [config.textureName] {string|null} the object sprite's texture, used by the EasyObject layers
     * @param [config.label] {string|null} the placement tool's label
     */
    constructor({
        table,
        inputPorts,
        outputPorts,
        internalPorts,
        geometry,
        tickPhases={},
        renderConnections=false,
        textureName=null,
        label=null,
    }) {
        if (ObjectGeometries[geometry] === undefined) {
            throw new Error(`Unknown object geometry "${geometry}"`);
        }
        this.table = table;
        this.inputPorts = inputPorts;
        this.outputPorts = outputPorts;
        this.internalPorts = internalPorts;
        // The named geometry; the `geometry` getter resolves it to the ObjectGeometry.
        this.geometryName = geometry;
        this.tickPhases = tickPhases;
        this.renderConnections = renderConnections;
        this.textureName = textureName;
        this.label = label;
        // The occupancy layer this object sits on. Objects on different layers coexist on a
        // tile; objects on the same layer collide. Multi-layer objects override occupancyLookups.
        this.occupancyLayer = OCCUPANCY_LAYER_SURFACE;
        // Stable numeric identity assigned by ModRegistry (registration order); the wire carries it
        // and the client cache keys off this definition. Null until the registry assigns it.
        this.typeId = null;
        // Extra non-port columns for the table (e.g. a machine's slots/cooldown), appended by
        // EasyObjectPlacement.
        this.stateColumns = [];
        // The verb this object implements over the shared Recipes table, or null. Set by EasyRecipeProcessor;
        // the schema seed validates each verb's recipes against the object's input-port count.
        this.verb = null;
    }

    /**
     * The geometry (tiles/corner/spansChunks) for this object's named size.
     * @returns {ObjectGeometry}
     */
    get geometry() {
        return ObjectGeometries[this.geometryName];
    }

    /**
     * SQL SELECT-1 fragments matching when this object covers tile (@x, @y) on layer @layer,
     * UNIONed by the engine into IsOccupied for placement collision. The default checks the
     * size-derived geometry in every orientation against this object's single layer; objects
     * whose layer depends on row state override this.
     * @param {string} table - this object's table name
     * @returns {string[]}
     */
    occupancyLookups(table) {
        const conditions = [];
        [Direction.UP, Direction.RIGHT, Direction.DOWN, Direction.LEFT].forEach(direction => {
            this.geometry.tiles(direction).forEach(cell => {
                conditions.push(`(${table}.direction = ${direction} AND ${table}.x = @x - ${cell.x} AND ${table}.y = @y - ${cell.y})`);
            });
        });
        return [`SELECT 1 FROM ${table} WHERE @layer = ${this.occupancyLayer} AND (${conditions.join(" OR ")})`];
    }

    /**
     * The subset of this object's `portKind` ports exposed for a record in state `data`. The
     * default is all of them; objects that bury a port in some states (a belt ramp) override this.
     * @param {("inputPorts"|"outputPorts")} portKind
     * @param {object} data - the record's data (type, direction, ...)
     * @returns {PortDefinition[]}
     */
    activePorts(portKind, data) {
        return this[portKind];
    }

    /**
     * The subset of activePorts a surface neighbor can connect to (for the client's connection
     * rendering / adjacency). The default is all active ports; objects that bury a port in some
     * states override this.
     * @param {("inputPorts"|"outputPorts")} portKind
     * @param {object} data - the record's data (type, direction, ...)
     * @returns {PortDefinition[]}
     */
    surfacePorts(portKind, data) {
        return this.activePorts(portKind, data);
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
                SELECT ${table}.${port.column} AS id
                FROM ${table}
                    INNER JOIN Port ON Port.id = ${table}.${port.column}
                WHERE ${table}.direction = ${direction}
                  AND ${table}.x = @x - ${offset.x}
                  AND ${table}.y = @y - ${offset.y}`;
        });
    }

    /**
     * SQL SELECT-1 fragments matching when this object references the outer Port.id through a port
     * column — UNIONed into the DeletePortIfUnreferenced GC guard. Override if ports live elsewhere.
     * @param {string} table
     * @returns {string[]}
     */
    portReferenceLookups(table) {
        return this._portReferenceFragment(table, [
            ...this.inputPorts,
            ...this.outputPorts,
            ...this.internalPorts,
        ]);
    }

    /**
     * As portReferenceLookups but for OUTPUT ports only — the DeletePortIfNotOutputReferenced guard.
     * @param {string} table
     * @returns {string[]}
     */
    outputPortReferenceLookups(table) {
        return this._portReferenceFragment(table, this.outputPorts);
    }

    /**
     * @private
     * @param {string} table
     * @param {PortDefinition[]} ports
     * @returns {string[]}
     */
    _portReferenceFragment(table, ports) {
        if (ports.length === 0) {
            return [];
        }
        const conditions = ports.map(port => `${table}.${port.column} = Port.id`).join(" OR ");
        return [`SELECT 1 FROM ${table} WHERE ${conditions}`];
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
     * @returns {SqlStatement[]}
     */
    get extraStatements() {
        return [];
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
     * Item type -> texture name, for the shared item layer.
     * @returns {Object.<number, string>}
     */
    get itemTextures() {
        return {};
    }

    /**
     * Recipes this mod contributes to the shared Recipes table (any mod may extend any verb).
     * @returns {RecipeDefinition[]}
     */
    get recipes() {
        return [];
    }

    /**
     * The fallback output per verb, produced when a machine's gathered inputs match no recipe.
     * @returns {{verb: number, output: number}[]}
     */
    get verbFallbacks() {
        return [];
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
     * Client-side inspect hook (null coords = cleared); returns the objects to highlight
     * and may update the mod's own draw layers.
     * @param {number|null} tileX
     * @param {number|null} tileY
     * @param {Client} client
     * @returns {InspectHighlight[]}
     */
    onInspect(tileX, tileY, client) {
        return [];
    }

    /**
     * Server-side hook returning the per-object events that recreate this mod's objects in a chunk.
     * @param {number} chunk - a chunk id that just entered a viewport
     * @returns {AbstractEvent[]}
     */
    chunkSyncEvents(chunk) {
        return [];
    }

    /**
     * Returns mini-menu entries (each with its own handler) for the tile at (tileX, tileY).
     * @param {number} tileX
     * @param {number} tileY
     * @param {AbstractSession} session
     * @param {Client} client
     * @returns {MiniMenuEntry[]}
     */
    miniMenuEntries(tileX, tileY, session, client) {
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

