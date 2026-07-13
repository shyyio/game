import {OCCUPANCY_LAYER_SURFACE} from "@/common/constants.js";
import {ObjectGeometries} from "@/common/ObjectGeometry.js";

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
     * (internal) Resolve the submitted transfer intents into this tick's moves
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
     * (internal) Commit the resolved moves to the ports
     */
    COMMIT_TRANSFERS: 6,

    /**
     * (internal, engine-only) Diff/emit the out-port render events after mods have captured this
     * tick's watched port items in COMMIT_TRANSFERS. Mods register no ops here.
     */
    EMIT_RENDER: 7,

    /**
     * Mods snapshot inspected machines here; the engine drains them to sessions in postTick.
     */
    EMIT_INSPECT: 8,
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
     * @param {number[]} inputs - one item per input port, in port order
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
     * @param config.name {string} the object type name (also the definitions-map key)
     * @param config.inputPorts {PortDefinition[]}
     * @param config.outputPorts {PortDefinition[]}
     * @param config.internalPorts {PortDefinition[]}
     * @param config.geometry {string} a named geometry (key of ObjectGeometries, e.g. "1x1", "1x2")
     * @param [config.renderConnections] {boolean} whether the shared ConnectionDrawLayer draws animated
     *     stubs at this object's connected ports (belts render their own bends instead)
     * @param [config.textureName] {string|null} the object sprite's texture, used by the EasyObject layers
     * @param [config.label] {string|null} the placement tool's label
     * @param [config.extractionTiles] {{x:number, y:number}[]|null} relative tiles an extractor draws
     *     this resource from (a resource's extraction set), used by the client placement tool
     */
    constructor({
        name,
        inputPorts,
        outputPorts,
        internalPorts,
        geometry,
        renderConnections=false,
        textureName=null,
        label=null,
        extractionTiles=null,
    }) {
        if (ObjectGeometries[geometry] === undefined) {
            throw new Error(`Unknown object geometry "${geometry}"`);
        }
        this.name = name;
        this.inputPorts = inputPorts;
        this.outputPorts = outputPorts;
        this.internalPorts = internalPorts;
        // The named geometry; the `geometry` getter resolves it to the ObjectGeometry.
        this.geometryName = geometry;
        this.renderConnections = renderConnections;
        this.textureName = textureName;
        this.label = label;
        // The occupancy layer this object sits on. Objects on different layers coexist on a tile.
        this.occupancyLayer = OCCUPANCY_LAYER_SURFACE;
        // Stable numeric identity assigned by ModRegistry (registration order); the wire carries it
        // and the client cache keys off this definition. Null until the registry assigns it.
        this.typeId = null;
        this.extractionTiles = extractionTiles;
    }

    /**
     * The geometry (tiles/corner/spansChunks) for this object's named size.
     * @returns {ObjectGeometry}
     */
    get geometry() {
        return ObjectGeometries[this.geometryName];
    }

    /**
     * The tiles this object occupies per layer facing `direction`: `{layer, cells}` records. The
     * default is its geometry body on its own layer; a resource overrides this (body + extraction on
     * the resource layer, body on the surface block). Used by both occupancyLookups (existing
     * objects) and the placement overlap check (the new object), so placement is symmetric.
     * @param {Direction} direction
     * @returns {{layer: number, cells: {x: number, y: number}[]}[]}
     */
    occupancyLayerTiles(direction) {
        const cells = this.geometry.tiles(direction);
        return [{layer: this.occupancyLayer, cells}];
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
     * @param {AbstractMessage} message
     */
    onMessage(message) {

    }

    /**
     * Registers this mod's bitECS content (modules, message handlers, chunk-sync contributors) on the
     * engine. The default registers nothing.
     * @param {EcsSimEngine} sim
     * @returns {void}
     */
    setupEcs(sim) {

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

